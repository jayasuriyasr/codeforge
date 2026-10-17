'use strict';

// ── Ephemeral judge sandbox manager (v4) ────────────────────────────────────
//
// One fresh container per submission. It is created, used for exactly one
// submission, and destroyed — never reused across submissions (so nothing a
// hostile submission leaves behind can touch the next contestant). The worker
// is therefore stateless: no pool, no per-container counters, no recycle logic.
//
// A tiny "warm buffer" of pre-created idle containers hides the ~0.5 s
// `docker run` latency; each is still used once and thrown away, and the buffer
// tops itself back up in the background.
//
// Isolation: the v3 hardening flag set, plus `--runtime=runsc` (gVisor) when the
// daemon reports it available. The container memory ceiling is a generous
// host-protection limit — the problem's real memory limit is enforced by
// measurement inside the supervisor (see judge/supervisor.py).

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { randomUUID } = require('crypto');
const { judge } = require('../config');

const execFileP = promisify(execFile);

const NAME_PREFIX = 'judge-';

const HARDENING_ARGS = [
  '--init', '--user', '1000:1000',
  `--memory=${judge.sandboxMemoryMb}m`, `--memory-swap=${judge.sandboxMemoryMb}m`,
  '--cpus=1.0', `--pids-limit=${judge.pidsLimit}`,
  '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
  '--read-only',
  '--tmpfs', '/dev/shm:rw,nosuid,nodev,noexec,size=1k,mode=1777',
  `--tmpfs`, `/workspace:rw,size=${judge.workspaceTmpfsMb}m,mode=1777,exec`,
];

let _runtimeArgs = null;   // ['--runtime=runsc'] or []
let _warm = [];            // names of pre-created, unused sandboxes
let _toppingUp = false;
let _shuttingDown = false;

// ── Runtime detection ───────────────────────────────────────────────────────
async function detectRuntimeArgs() {
  if (_runtimeArgs) return _runtimeArgs;
  try {
    const { stdout } = await execFileP('docker', ['info', '--format', '{{json .Runtimes}}']);
    _runtimeArgs = /runsc/.test(stdout) ? ['--runtime=runsc'] : [];
    if (_runtimeArgs.length) console.log('[sandbox] gVisor (runsc) runtime available — using it');
  } catch {
    _runtimeArgs = [];
  }
  return _runtimeArgs;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
async function spawnOne() {
  const name = `${NAME_PREFIX}${randomUUID()}`;
  const runtimeArgs = await detectRuntimeArgs();
  await execFileP('docker', [
    'run', '-d', '--name', name,
    ...runtimeArgs, ...HARDENING_ARGS,
    judge.image,
    'sleep', 'infinity',
  ]);
  return name;
}

async function destroySandbox(name) {
  if (!name) return;
  await execFileP('docker', ['rm', '-f', name]).catch(() => {});
}

/** Get a sandbox for one submission. Caller MUST call destroySandbox() when done. */
async function acquireSandbox() {
  const warm = _warm.pop();
  topUpWarmBuffer();               // refill in the background
  if (warm) {
    // Confirm it is still alive; if the daemon reaped it, fall through to a fresh one.
    try {
      const { stdout } = await execFileP('docker', ['inspect', '-f', '{{.State.Running}}', warm]);
      if (stdout.trim() === 'true') return warm;
    } catch { /* dead — make a new one */ }
    destroySandbox(warm);
  }
  return spawnOne();
}

function topUpWarmBuffer() {
  if (_toppingUp || _shuttingDown) return;
  const deficit = judge.warmSandboxes - _warm.length;
  if (deficit <= 0) return;
  _toppingUp = true;
  (async () => {
    for (let i = 0; i < deficit && !_shuttingDown; i++) {
      try { _warm.push(await spawnOne()); } catch (e) {
        console.error('[sandbox] warm spawn failed:', e.message);
        break;
      }
    }
    _toppingUp = false;
  })();
}

// ── Supervisor exec ────────────────────────────────────────────────────────
class SandboxError extends Error {}   // infra fault — never a verdict

/**
 * Run the in-sandbox supervisor. Writes `spec` as JSON to its stdin, returns the
 * parsed JSON result. Throws SandboxError on any infrastructure fault (daemon
 * gone, container vanished, our own wall-clock guard tripped, garbage output).
 *
 * @param {string} name    sandbox container name
 * @param {'compile'|'run'} mode
 * @param {object} spec
 * @param {{ timeoutMs: number }} opts
 */
function execSupervisor(name, mode, spec, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', name,
      'python3', '/opt/supervisor.py', mode,
    ]);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new SandboxError(`supervisor ${mode} exceeded ${timeoutMs}ms wall-clock guard`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { if (stdout.length < 8 * 1024 * 1024) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 256 * 1024) stderr += d; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      reject(new SandboxError(`docker exec failed: ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (code !== 0 && !stdout.trim()) {
        return reject(new SandboxError(
          `supervisor ${mode} exited ${code}: ${stderr.slice(0, 500)}`
        ));
      }
      let parsed;
      try { parsed = JSON.parse(stdout.trim().split('\n').pop()); }
      catch { return reject(new SandboxError(`supervisor ${mode} returned non-JSON: ${stdout.slice(0, 500)}`)); }
      if (parsed.ok === false) {
        return reject(new SandboxError(`supervisor ${mode} error: ${parsed.error}`));
      }
      resolve(parsed);
    });

    child.stdin.on('error', () => {});   // ignore EPIPE if the child died early
    child.stdin.write(JSON.stringify(spec));
    child.stdin.end();
  });
}

// ── Startup / shutdown ─────────────────────────────────────────────────────
async function reapOrphans() {
  try {
    const { stdout } = await execFileP('docker', [
      'ps', '-aq', '--filter', `name=${NAME_PREFIX}`,
    ]);
    const ids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (ids.length) {
      await execFileP('docker', ['rm', '-f', ...ids]).catch(() => {});
      console.log(`[sandbox] reaped ${ids.length} orphan sandbox(es)`);
    }
  } catch (e) {
    console.error('[sandbox] orphan reap skipped:', e.message);
  }
}

async function init() {
  await reapOrphans();
  await detectRuntimeArgs();
  topUpWarmBuffer();
}

async function shutdown() {
  _shuttingDown = true;
  const names = _warm.splice(0);
  await Promise.allSettled(names.map(destroySandbox));
}

module.exports = {
  init,
  shutdown,
  acquireSandbox,
  destroySandbox,
  execSupervisor,
  reapOrphans,
  SandboxError,
  HARDENING_ARGS,          // exported for tests
  detectRuntimeArgs,
  NAME_PREFIX,
};

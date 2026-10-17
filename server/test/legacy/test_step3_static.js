'use strict';

// ── Static unit test for containerPool.js ────────────────────────────────────
// No Docker required. Verifies: constants, counter helpers, export shape,
// and that HARDENING_ARGS contains every flag from §2 of the arch doc.

const {
  POOL_DEFAULT_MEMORY_MB,
  RECYCLE_AFTER_N,
  HARDENING_ARGS,
  IMAGE,
  getSubmissionCount,
  incrementSubmissionCount,
  resetSubmissionCount,
  pool,
} = require('./src/judge/containerPool');

let passed = 0, failed = 0;

function assert(label, fn) {
  try { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.message}`); failed++; }
}

// ── Constants ─────────────────────────────────────────────────────────────────
console.log('\n── Constants ─────────────────────────────────────────────────────');

assert('POOL_DEFAULT_MEMORY_MB = 256', () => {
  if (POOL_DEFAULT_MEMORY_MB !== 256) throw new Error(`Got ${POOL_DEFAULT_MEMORY_MB}`);
});

assert('RECYCLE_AFTER_N = 200', () => {
  if (RECYCLE_AFTER_N !== 200) throw new Error(`Got ${RECYCLE_AFTER_N}`);
});

assert('IMAGE contains sha256 placeholder or real digest', () => {
  if (!IMAGE.startsWith('codeforge/fat-judge@sha256:'))
    throw new Error(`Got "${IMAGE}"`);
});

// ── HARDENING_ARGS — every flag from §2 must be present ─────────────────────
console.log('\n── Hardening flags (§2 arch doc) ────────────────────────────────');
const joined = HARDENING_ARGS.join(' ');

const requiredFlags = [
  ['--init',                                     '--init present'],
  ['--user 1000:1000',                           '--user 1000:1000'],
  ['--memory=256m',                              '--memory=256m'],
  ['--memory-swap=256m',                         '--memory-swap=256m'],
  ['--cpus=1.0',                                 '--cpus=1.0'],
  ['--pids-limit=64',                            '--pids-limit=64'],
  ['--network=none',                             '--network=none'],
  ['--cap-drop=ALL',                             '--cap-drop=ALL'],
  ['--security-opt=no-new-privileges',           '--security-opt=no-new-privileges'],
  ['--read-only',                                '--read-only'],
  ['/dev/shm:rw,nosuid,nodev,noexec,size=1k,mode=1777', '/dev/shm tmpfs with size=1k (not 64m)'],
  ['/workspace:rw,size=64m,mode=1777,exec',      '/workspace tmpfs exec mount'],
];

for (const [flag, label] of requiredFlags) {
  assert(label, () => {
    if (!joined.includes(flag)) throw new Error(`Missing: "${flag}"`);
  });
}

assert('/dev/shm tmpfs uses size=1k, not size=64m', () => {
  // Find the specific /dev/shm tmpfs argument (not the /workspace one)
  const shmArg = HARDENING_ARGS.find(a => a.includes('/dev/shm'));
  if (!shmArg) throw new Error('No /dev/shm tmpfs arg found');
  if (!shmArg.includes('size=1k')) throw new Error(`/dev/shm arg missing size=1k: "${shmArg}"`);
  if (shmArg.includes('size=64m')) throw new Error(`/dev/shm arg has size=64m — should be size=1k: "${shmArg}"`);
});

// ── Submission counter helpers ────────────────────────────────────────────────
console.log('\n── Submission counter helpers ─────────────────────────────────────');

assert('getSubmissionCount returns 0 for unknown name', () => {
  if (getSubmissionCount('nonexistent') !== 0) throw new Error('Expected 0');
});

assert('incrementSubmissionCount increments correctly', () => {
  const name = 'test-container-abc';
  incrementSubmissionCount(name);
  incrementSubmissionCount(name);
  if (getSubmissionCount(name) !== 2) throw new Error(`Expected 2, got ${getSubmissionCount(name)}`);
});

assert('resetSubmissionCount clears back to 0', () => {
  const name = 'test-container-abc';
  resetSubmissionCount(name);
  if (getSubmissionCount(name) !== 0) throw new Error('Expected 0 after reset');
});

// ── Pool shape ────────────────────────────────────────────────────────────────
console.log('\n── Pool shape ────────────────────────────────────────────────────');

assert('pool.acquire is a function', () => {
  if (typeof pool.acquire !== 'function') throw new Error('not a function');
});

assert('pool.release is a function', () => {
  if (typeof pool.release !== 'function') throw new Error('not a function');
});

assert('pool.destroy is a function', () => {
  if (typeof pool.destroy !== 'function') throw new Error('not a function');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
if (failed > 0) process.exit(1);

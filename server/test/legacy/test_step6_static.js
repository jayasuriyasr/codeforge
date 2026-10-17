'use strict';

// ── Acceptance test — Phase 3B (runner.js, cleanup.js, errors.js) ─────────────
// Static tests: classifyResult, isInfraFailure, module exports, constants.
// Docker tests: setMemoryCeiling, compile step, run step — gated on Docker.

const { classifyResult, setMemoryCeiling, runSubmission, COMPILE_TIMEOUT_SEC, POOL_DEFAULT_MEMORY_MB } = require('./src/judge/runner');
const { isInfraFailure } = require('./src/judge/errors');
const { cleanupContainer } = require('./src/judge/cleanup');

let passed = 0, failed = 0;

function assert(label, fn) {
  try   { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.message}`); failed++; }
}

// ── Constants ─────────────────────────────────────────────────────────────────
console.log('\n── Constants ────────────────────────────────────────────────────');
assert('COMPILE_TIMEOUT_SEC = 10',       () => { if (COMPILE_TIMEOUT_SEC !== 10)  throw new Error(`Got ${COMPILE_TIMEOUT_SEC}`); });
assert('POOL_DEFAULT_MEMORY_MB = 256',   () => { if (POOL_DEFAULT_MEMORY_MB !== 256) throw new Error(`Got ${POOL_DEFAULT_MEMORY_MB}`); });

// ── Module exports ────────────────────────────────────────────────────────────
console.log('\n── Module exports ────────────────────────────────────────────────');
assert('setMemoryCeiling is a function',  () => { if (typeof setMemoryCeiling !== 'function')  throw new Error(); });
assert('classifyResult is a function',    () => { if (typeof classifyResult !== 'function')    throw new Error(); });
assert('runSubmission is a function',     () => { if (typeof runSubmission !== 'function')     throw new Error(); });
assert('isInfraFailure is a function',    () => { if (typeof isInfraFailure !== 'function')    throw new Error(); });
assert('cleanupContainer is a function',  () => { if (typeof cleanupContainer !== 'function')  throw new Error(); });

// ── classifyResult — verbatim from §3 ────────────────────────────────────────
console.log('\n── classifyResult (§3 TLE/MLE heuristic) ───────────────────────');
const prob = { timeLimitSec: 2 };  // 2000ms limit → TLE threshold = 1800ms

assert('exit 0 → AC_CANDIDATE', () => {
  const v = classifyResult({ code: 0, signal: null }, prob, 500);
  if (v !== 'AC_CANDIDATE') throw new Error(`Got "${v}"`);
});

assert('exit 1 (non-zero, non-137) → RE', () => {
  const v = classifyResult({ code: 1, signal: null }, prob, 500);
  if (v !== 'RE') throw new Error(`Got "${v}"`);
});

assert('exit 2 → RE', () => {
  const v = classifyResult({ code: 2, signal: null }, prob, 300);
  if (v !== 'RE') throw new Error(`Got "${v}"`);
});

assert('SIGKILL + durationMs >= limit-200ms → TLE', () => {
  // 2000ms limit, killed at 1900ms — near time limit
  const v = classifyResult({ code: 137, signal: 'SIGKILL' }, prob, 1900);
  if (v !== 'TLE') throw new Error(`Got "${v}"`);
});

assert('SIGKILL + durationMs exactly at limit-200ms boundary → TLE', () => {
  const v = classifyResult({ code: 137, signal: 'SIGKILL' }, prob, 1800);
  if (v !== 'TLE') throw new Error(`Got "${v}"`);
});

assert('SIGKILL + durationMs well below limit → MLE', () => {
  // Killed at 300ms — cgroup OOM-kill, not time limit
  const v = classifyResult({ code: 137, signal: 'SIGKILL' }, prob, 300);
  if (v !== 'MLE') throw new Error(`Got "${v}"`);
});

assert('signal=SIGKILL (code null) near limit → TLE', () => {
  const v = classifyResult({ code: null, signal: 'SIGKILL' }, prob, 1950);
  if (v !== 'TLE') throw new Error(`Got "${v}"`);
});

assert('signal=SIGKILL (code null) early → MLE', () => {
  const v = classifyResult({ code: null, signal: 'SIGKILL' }, prob, 100);
  if (v !== 'MLE') throw new Error(`Got "${v}"`);
});

assert('exit 137 near limit → TLE (code alone without signal)', () => {
  const v = classifyResult({ code: 137, signal: null }, prob, 1900);
  if (v !== 'TLE') throw new Error(`Got "${v}"`);
});

assert('exit 137 early → MLE (code alone without signal)', () => {
  const v = classifyResult({ code: 137, signal: null }, prob, 200);
  if (v !== 'MLE') throw new Error(`Got "${v}"`);
});

// ── isInfraFailure — must NOT fire on normal exits ────────────────────────────
console.log('\n── isInfraFailure ───────────────────────────────────────────────');

assert('null → false', () => {
  if (isInfraFailure(null)) throw new Error('returned true for null');
});

assert('plain exit 1 error (RE) → false', () => {
  const err = new Error('Command failed with exit code 1'); err.code = 1;
  if (isInfraFailure(err)) throw new Error('returned true for plain RE');
});

assert('exit 137 SIGKILL (TLE/MLE) → false', () => {
  const err = new Error('Command failed with exit code 137'); err.code = 137; err.signal = 'SIGKILL';
  if (isInfraFailure(err)) throw new Error('returned true for TLE/MLE signal');
});

assert('"no such container" error → true', () => {
  const err = new Error('Error response from daemon: No such container: judge-worker-abc');
  if (!isInfraFailure(err)) throw new Error('returned false for missing container');
});

assert('ENOENT (docker binary missing) → true', () => {
  const err = new Error('spawn docker ENOENT'); err.code = 'ENOENT';
  if (!isInfraFailure(err)) throw new Error('returned false for ENOENT');
});

assert('ECONNREFUSED (daemon down) → true', () => {
  const err = new Error('connect ECONNREFUSED /var/run/docker.sock'); err.code = 'ECONNREFUSED';
  if (!isInfraFailure(err)) throw new Error('returned false for ECONNREFUSED');
});

assert('"failed to connect to the docker" → true', () => {
  const err = new Error('failed to connect to the docker API at npipe://...');
  if (!isInfraFailure(err)) throw new Error('returned false for docker connect error');
});

assert('"ResourceRequest timed out" (pool exhausted) → true', () => {
  const err = new Error('ResourceRequest timed out');
  if (!isInfraFailure(err)) throw new Error('returned false for pool exhausted');
});

assert('generic non-docker error → false', () => {
  const err = new Error('something random');
  if (isInfraFailure(err)) throw new Error('returned true for unrelated error');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
console.log('\n── Docker-gated acceptance checks (need docker compose up --build) ──');
console.log('   Run node test_step6_live.js for:');
console.log('   - C++ "hello world" → AC_CANDIDATE');
console.log('   - Infinite loop → TLE');
console.log('   - JVM near memoryLimitMB → no false MLE (cgroup, not ulimit)');
console.log('   - CE: compile failure stops before run step');
console.log('   - setMemoryCeiling actually applied via docker inspect/stats');
if (failed > 0) process.exit(1);

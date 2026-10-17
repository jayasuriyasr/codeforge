'use strict';

// ── Queue / judge invariant constants ───────────────────────────────────────
// Single source of truth. Used by:
//   1. assertProblemLimits()  — problem-save time (admin route)
//   2. assertProblemLimits()  — enqueue time (defensive) and worker (defensive)
//   3. queue/worker.js        — LOCK_DURATION_MS

const MAX_ALLOWED_TIME_LIMIT_SEC = 10;   // per test case
const COMPILE_TIMEOUT_SEC        = 10;
const LOCK_SAFETY_MARGIN_SEC     = 5;
const POOL_DEFAULT_MEMORY_MB     = 256;  // ceiling a problem may configure
const MAX_CASES_PER_RUN          = 200;  // matches config.judge.maxCasesPerRun default

// v4: each test case runs under its OWN per-case timeout, so a job's wall time is
// bounded by compile + (cases × per-case limit). BullMQ renews the job lock while
// the processor runs, so this constant only needs to survive a normal event-loop
// hiccup, not the whole worst-case run — 120 s is comfortably above any GC pause.
const LOCK_DURATION_MS = 120_000;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

/**
 * Validate a problem's judge limits against the invariants the queue depends on.
 * @param {{ timeLimitSec:number, memoryLimitMB:number, testCases?:Array }} problem
 * @throws {ValidationError}
 */
function assertProblemLimits(problem) {
  if (typeof problem.timeLimitSec !== 'number' || Number.isNaN(problem.timeLimitSec)) {
    throw new ValidationError('timeLimitSec must be a number');
  }
  if (typeof problem.memoryLimitMB !== 'number' || Number.isNaN(problem.memoryLimitMB)) {
    throw new ValidationError('memoryLimitMB must be a number');
  }
  if (problem.timeLimitSec > MAX_ALLOWED_TIME_LIMIT_SEC) {
    throw new ValidationError(
      `timeLimitSec (${problem.timeLimitSec}) exceeds queue ceiling of ${MAX_ALLOWED_TIME_LIMIT_SEC}s`
    );
  }
  if (problem.memoryLimitMB > POOL_DEFAULT_MEMORY_MB) {
    throw new ValidationError(
      `memoryLimitMB (${problem.memoryLimitMB}) exceeds container ceiling of ${POOL_DEFAULT_MEMORY_MB}MB`
    );
  }
  if (Array.isArray(problem.testCases) && problem.testCases.length > MAX_CASES_PER_RUN) {
    throw new ValidationError(
      `problem has ${problem.testCases.length} test cases; the limit is ${MAX_CASES_PER_RUN}`
    );
  }
}

module.exports = {
  assertProblemLimits,
  ValidationError,
  MAX_ALLOWED_TIME_LIMIT_SEC,
  COMPILE_TIMEOUT_SEC,
  LOCK_SAFETY_MARGIN_SEC,
  POOL_DEFAULT_MEMORY_MB,
  MAX_CASES_PER_RUN,
  LOCK_DURATION_MS,
};

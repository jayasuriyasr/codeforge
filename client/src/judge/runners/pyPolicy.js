// client/src/judge/runners/pyPolicy.js
// ── Python judge: limits and verdict rules ─────────────────────────────────
// The pure part of the Python runner (python.js): no Worker, no Pyodide, so it
// can be unit-tested in plain Node. Every number here was measured on the live
// site (Pyodide 0.26.4) before it was chosen.

export const MB = 1048576;

/** Allocator overhead allowed on top of the problem's memory limit. */
export const SLACK_MB = 8;

/**
 * A test "started clean" when earlier tests in this Pyodide grew the allocator
 * by less than this. Only then is a refused growth trusted as MLE: memory left
 * in pieces by earlier tests can make a program that fits ask for more.
 */
export const CLEAN_MB = 16;

/**
 * The program is interrupted at GRACE × the limit, not at the limit itself. A
 * run that finishes in between is "borderline" and gets one more run
 * — browsers only have wall-clock time, and the same program measured up to
 * 1.7× apart on different runs.
 */
export const GRACE = 1.5;

/** …but never more than this past the limit (an infinite loop should not wait long). */
export const MAX_GRACE_MS = 3000;

/** When the interrupt is sent: GRACE × the limit, at most MAX_GRACE_MS past it. */
export function stopAtMs(limitMs) {
  return limitMs + Math.min((GRACE - 1) * limitMs, MAX_GRACE_MS);
}

/**
 * If the program is still running this long after the interrupt, the worker is
 * terminated. Loop-free recursion (naive fib) and one long C call
 * (sum(range(10**10))) never look at the interrupt buffer.
 */
export const KILL_AFTER_MS = 200;

/**
 * Time of the device-speed benchmark (BENCH_PY in python.js) on the machine the
 * Python time limits were calibrated on. A slower device gets proportionally
 * more time, never less, and at most MAX_DEVICE_FACTOR×.
 */
export const REF_BENCH_MS = 85;   // measured 79–84 ms; a little above, so that machine gets 1.0
export const MAX_DEVICE_FACTOR = 3;

/** Write this into the interrupt buffer: it is SIGINT. 1 (SIGHUP) is ignored. */
export const SIGINT = 2;

export function deviceFactor(benchMs, refMs = REF_BENCH_MS) {
  if (!(benchMs > 0) || !(refMs > 0)) return 1;
  return Math.min(MAX_DEVICE_FACTOR, Math.max(1, benchMs / refMs));
}

/**
 * The time limit for one language. Python gets the calibrated limit when the
 * problem has one (never less than the problem's own limit).
 */
export function timeLimitSecFor(language, { timeLimitSec, pythonTimeLimitSec } = {}) {
  const base = Number(timeLimitSec) > 0 ? Number(timeLimitSec) : 2;
  if (language !== 'python') return base;
  const py = Number(pythonTimeLimitSec);
  return py > base ? py : base;
}

/** Heap size to pre-grow to: the heap top after warm-up + limit + slack, in 64 KiB pages. */
export function capHeapBytes(baseTopBytes, memLimitMb) {
  if (!Number.isFinite(memLimitMb)) return Infinity;
  const raw = baseTopBytes + (memLimitMb + SLACK_MB) * MB;
  return Math.ceil(raw / 65536) * 65536;
}

/**
 * Turn one finished run into a decision.
 *   run: { killed, interrupted, ok, oom, refused, runMs, memMb, startMb }
 * Returns one of:
 *   'TLE' | 'MLE' | 'RE' | 'OK'
 *   'RERUN'     finished between 1× and GRACE× the limit → run it once more
 *   'RECHECK'   memory refused on a reused heap → run it again on a fresh Pyodide
 */
export function decide(run, { limitMs, memLimitMb = Infinity, rerun = false, recheck = false } = {}) {
  if (run.killed || run.interrupted) return 'TLE';
  const overMem = run.oom || run.refused || (Number.isFinite(memLimitMb) && run.memMb > memLimitMb + SLACK_MB);
  if (overMem) return run.startMb <= CLEAN_MB || recheck ? 'MLE' : 'RECHECK';
  if (!run.ok) return 'RE';
  if (run.runMs <= limitMs) return 'OK';
  if (run.runMs <= stopAtMs(limitMs) && !rerun) return 'RERUN';
  return 'TLE';
}

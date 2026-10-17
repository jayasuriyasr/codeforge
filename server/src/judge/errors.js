'use strict';

// ── isInfraFailure ────────────────────────────────────────────────────────────
// Detects genuine infrastructure faults — things that mean the container itself
// is broken, not things that mean the submission was wrong.
//
// CRITICAL DISTINCTION (from arch doc §1 and §2):
//   - TLE / MLE / WA / RE / CE  →  successful jobs whose RESULT is a verdict.
//     The job resolves normally. isInfraFailure() must return false for all of these.
//   - Docker daemon down / container gone / pool exhausted
//     →  the container is broken.  isInfraFailure() returns true.
//     The Worker then calls pool.destroy() instead of pool.release().
//
// Firing this on an ordinary WA or TLE would waste pool capacity by triggering
// an unnecessary destroy+respawn cycle on every wrong-answer submission.

const INFRA_ERROR_PATTERNS = [
  /no such container/i,
  /cannot find the container/i,
  /ENOENT/,                          // docker binary not found, socket path wrong
  /ECONNREFUSED/,                    // daemon not listening
  /ECONNRESET/,                      // daemon dropped connection mid-call
  /failed to connect to the docker/i,
  /Error response from daemon/i,
  /context deadline exceeded/i,
  /pool.*exhausted/i,                // generic-pool AcquireError
  /ResourceRequest timed out/i,      // generic-pool timeout error message
];

/**
 * Returns true only if the error represents a genuine infrastructure failure —
 * i.e. something that means the Docker container itself is broken or unreachable.
 *
 * Returns false for:
 *   - Non-zero exit codes from user code (RE, TLE via timeout, MLE via OOM-kill)
 *   - Compilation errors (CE) — these are just a stderr + non-zero exit from javac/g++
 *   - Any error that doesn't indicate the container is unusable
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isInfraFailure(err) {
  if (!err) return false;

  const msg = (err.message || '') + (err.stderr || '') + (err.code || '');

  // A plain non-zero exit (e.g. user code crashed with exit 1) is NOT infra failure.
  // execFile rejects with { code: <number> } for non-zero exits — we only care about
  // the message content, not the numeric exit code itself.
  // Exit code 137 (SIGKILL) also isn't an infra failure — it's TLE or MLE.
  // We only escalate if the message matches a known daemon/socket/container pattern.
  for (const pattern of INFRA_ERROR_PATTERNS) {
    if (pattern.test(msg)) return true;
  }

  return false;
}

module.exports = { isInfraFailure };

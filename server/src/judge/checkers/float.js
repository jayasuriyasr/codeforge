'use strict';

// ── Float checker (problem.checkerType === 'float') ───────────────────────────
// Token-wise compare with absolute and relative epsilon.
// Used for problems whose output contains floating-point numbers where small
// rounding differences should be accepted.
//
// From §7 of the arch doc: "token-wise compare with an absolute/relative epsilon;
// needed for any problem with floating-point output."
// The contract is named but not fully built out in the doc — this is a reasonable
// MVP implementation.
//
// Algorithm:
//   1. Split both actual and expected into whitespace-delimited tokens.
//   2. Token counts must match exactly.
//   3. For each token pair:
//      a. If both parse as finite numbers → accept if |a - e| <= max(ABSOLUTE_EPS, RELATIVE_EPS * |e|)
//      b. If either does NOT parse as a number → require exact string equality.
//   4. Any mismatch → WA.

const ABSOLUTE_EPS = 1e-9;   // accept differences smaller than this regardless of magnitude
const RELATIVE_EPS = 1e-6;   // accept differences smaller than this fraction of the expected value

/**
 * Tokenise a string into whitespace-separated tokens.
 * @param {string} s
 * @returns {string[]}
 */
function tokenise(s) {
  return s.trim().split(/\s+/).filter(t => t.length > 0);
}

/**
 * Float checker — token-wise compare with absolute/relative epsilon.
 *
 * @param {string} actual    stdout from the submission
 * @param {string} expected  expected output from the test case
 * @param {{ absoluteEps?: number, relativeEps?: number }} [opts]
 * @returns {{ accepted: boolean, message?: string }}
 */
function floatChecker(actual, expected, opts = {}) {
  const absEps = opts.absoluteEps ?? ABSOLUTE_EPS;
  const relEps = opts.relativeEps ?? RELATIVE_EPS;

  const actualTokens   = tokenise(actual);
  const expectedTokens = tokenise(expected);

  if (actualTokens.length !== expectedTokens.length) {
    return {
      accepted: false,
      message:  `token count mismatch: got ${actualTokens.length}, expected ${expectedTokens.length}`,
    };
  }

  for (let i = 0; i < expectedTokens.length; i++) {
    const a = actualTokens[i];
    const e = expectedTokens[i];

    const aNum = Number(a);
    const eNum = Number(e);

    if (isFinite(aNum) && isFinite(eNum)) {
      // Both are numbers — apply epsilon comparison
      const diff      = Math.abs(aNum - eNum);
      const threshold = Math.max(absEps, relEps * Math.abs(eNum));
      if (diff > threshold) {
        return {
          accepted: false,
          message:  `token ${i + 1}: |${aNum} - ${eNum}| = ${diff} exceeds tolerance ${threshold}`,
        };
      }
    } else {
      // Non-numeric token — require exact string equality
      if (a !== e) {
        return {
          accepted: false,
          message:  `token ${i + 1}: "${a}" !== "${e}" (non-numeric, exact match required)`,
        };
      }
    }
  }

  return { accepted: true };
}

module.exports = { floatChecker, tokenise, ABSOLUTE_EPS, RELATIVE_EPS };

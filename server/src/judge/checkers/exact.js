'use strict';

// ── Exact checker (problem.checkerType === 'exact') ───────────────────────────
// Default checker from §7 of the arch doc — copied verbatim.
//
// Normalisation rules:
//   1. Trailing whitespace (spaces/tabs) stripped from every line.
//   2. Trailing blank lines stripped from the whole output.
//   3. Everything else is a strict byte compare — capitalisation, spacing
//      within a line, and interior blank lines all matter.
//
// This is intentionally NOT a "token-wise" compare — that's the float checker.
// Two outputs that differ only in trailing whitespace or a trailing newline are
// considered identical; any other difference is WA.

/**
 * Normalise a string for exact comparison.
 * @param {string} s
 * @returns {string}
 */
function norm(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')               // CRLF / CR → LF (admin may paste from Windows)
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))    // strip trailing spaces/tabs per line
    .join('\n')
    .replace(/\n+$/, '');                  // strip trailing blank lines
}

/**
 * Default checker — line-trimmed, trailing-newline-insensitive byte compare.
 *
 * @param {string} actual    stdout from the submission
 * @param {string} expected  expected output from the test case
 * @returns {boolean}        true = AC, false = WA
 */
function defaultChecker(actual, expected) {
  return norm(actual) === norm(expected);
}

module.exports = { defaultChecker, norm };

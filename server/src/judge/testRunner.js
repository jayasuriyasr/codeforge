'use strict';

// ── Checker orchestration ───────────────────────────────────────────────────
// Pure logic — no Docker, no network. Given a submission's captured stdout for
// each test case, decide AC / WA.
//
//   checkerType:
//     'exact'   (default) — line-trimmed, trailing-newline-insensitive compare
//     'float'             — token-wise compare with absolute/relative epsilon
//     'special'           — external checker binary (Phase 5; currently a stub
//                            that surfaces as INFRA_ERROR rather than a silent pass)

const { defaultChecker }                                    = require('./checkers/exact');
const { floatChecker }                                      = require('./checkers/float');
const { specialChecker, SpecialCheckerNotImplementedError } = require('./checkers/special');

/**
 * Check one case's output. Returns { accepted, message }.
 * Throws SpecialCheckerNotImplementedError for the 'special' stub.
 */
function checkOne(checkerType, actual, expected, { input, problem, opts } = {}) {
  switch (checkerType || 'exact') {
    case 'exact':
      return { accepted: defaultChecker(actual, expected) };
    case 'float': {
      const r = floatChecker(actual, expected, opts || {});
      return { accepted: r.accepted, message: r.message };
    }
    case 'special': {
      const r = specialChecker(input, actual, expected, problem);
      return { accepted: r.accepted, message: r.message };
    }
    default:
      // accepted:undefined signals "cannot judge" → caller maps to INFRA_ERROR.
      return { accepted: undefined, message: `unknown checkerType: "${checkerType}"` };
  }
}

/**
 * Run the checker against every test case, short-circuiting on the first WA.
 * (Retained for the standalone checker unit tests; the worker uses checkOne via
 *  judge/verdict.js so it can interleave per-case sandbox status.)
 */
function runChecks(problem, actualOutputs, opts = {}) {
  const { testCases = [], checkerType = 'exact' } = problem;

  if (actualOutputs.length !== testCases.length) {
    return {
      verdict: 'INFRA_ERROR',
      failedIndex: null,
      message: `actualOutputs.length (${actualOutputs.length}) !== testCases.length (${testCases.length})`,
      checkedCount: 0,
    };
  }
  if (testCases.length === 0) {
    return { verdict: 'AC', failedIndex: null, checkedCount: 0 };
  }

  for (let i = 0; i < testCases.length; i++) {
    const { input, expectedOutput } = testCases[i];
    let res;
    try {
      res = checkOne(checkerType, actualOutputs[i], expectedOutput, { input, problem, opts });
    } catch (err) {
      if (err instanceof SpecialCheckerNotImplementedError) {
        return { verdict: 'INFRA_ERROR', failedIndex: i, message: err.message, checkedCount: i };
      }
      throw err;
    }
    if (res.accepted === undefined && res.message) {
      return { verdict: 'INFRA_ERROR', failedIndex: i, message: res.message, checkedCount: i };
    }
    if (!res.accepted) {
      return {
        verdict: 'WA',
        failedIndex: i,
        message: res.message || `test case ${i + 1} failed`,
        checkedCount: i + 1,
        failedTestCase: { input, expectedOutput, actualOutput: actualOutputs[i] || '' },
      };
    }
  }

  return { verdict: 'AC', failedIndex: null, checkedCount: testCases.length };
}

module.exports = { runChecks, checkOne, SpecialCheckerNotImplementedError };

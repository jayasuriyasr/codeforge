'use strict';

// ── Special checker stub (problem.checkerType === 'special') ──────────────────
// From §7 of the arch doc:
//   "an external checker binary, run in its own pool slot under the same
//    time/memory discipline as the submission itself (it's still untrusted-ish
//    code touching user output), fed (input, submissionOutput, expectedOutput)
//    and returning AC/WA plus an optional message."
//
// MVP STATUS: named contract, not yet implemented.
// The interface is defined here so the testRunner can dispatch to it correctly,
// but invoking it returns a clear error rather than silently doing nothing wrong.
//
// What a full implementation would require (documented, not built):
//   1. A checker binary path stored on the Problem document (problem.checkerBin).
//   2. A pool slot acquired from the container pool (same time/memory discipline).
//   3. docker exec feeding (inputFile, actualFile, expectedFile) to the binary.
//   4. The binary exits 0 for AC, non-zero for WA, writing a message to stdout/stderr.
//   5. The result parsed and returned as { accepted, message }.
//
// When a problem has checkerType === 'special' and this stub is invoked, the
// testRunner will treat it as an INFRA_ERROR so the gap is visible, not silent.

class SpecialCheckerNotImplementedError extends Error {
  constructor() {
    super(
      'Special checker (checkerType==="special") is a named MVP stub — ' +
      'external checker binary execution is not yet implemented. ' +
      'Wire up a real binary runner before using this checker type in production.'
    );
    this.name   = 'SpecialCheckerNotImplementedError';
    this.status = 501;
  }
}

/**
 * Special checker interface — currently a named stub.
 *
 * @param {string} input            The problem's input for this test case
 * @param {string} submissionOutput stdout from the submission
 * @param {string} expectedOutput   expected output (may be empty for special checkers)
 * @param {object} [problem]        The Problem document (for checkerBin path etc.)
 * @returns {{ accepted: boolean, message: string }}
 * @throws {SpecialCheckerNotImplementedError} always — stub not yet implemented
 */
// eslint-disable-next-line no-unused-vars
function specialChecker(input, submissionOutput, expectedOutput, problem) {
  throw new SpecialCheckerNotImplementedError();
}

module.exports = { specialChecker, SpecialCheckerNotImplementedError };

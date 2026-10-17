'use strict';

// ── Verdict assembly (v4) ───────────────────────────────────────────────────
// Pure function: (supervisor compile result, supervisor run result, problem) →
// the final judged outcome. No Docker, no DB — fully unit-testable.
//
// Supervisor per-case `status` is one of OK | TLE | MLE | RE | OLE. For an `OK`
// case we still have to run the checker (AC vs WA). Anything else is already a
// verdict. We stop at the first non-AC case (short-circuit) — the supervisor
// itself also stops early when told to (pretests).

const { checkOne, SpecialCheckerNotImplementedError } = require('./testRunner');

const b64 = (s) => Buffer.from(s || '', 'base64').toString('utf8');

// Supervisor status → contestant verdict for a non-OK case.
const STATUS_VERDICT = { TLE: 'TLE', MLE: 'MLE', RE: 'RE', OLE: 'RE' };

class JudgeInfraError extends Error {}

/**
 * @param {object}   compile   { ok, ms, stderr }
 * @param {object|null} run     { cases: [ {index,status,wall_ms,mem_mb,stdout_b64,stderr_b64} ] }
 *                              `index` is the REAL index into problem.testCases.
 * @param {object}   problem    { testCases:[{input,expectedOutput}], checkerType }
 * @param {object}   [opts]     { floatOpts, expectedCaseCount }
 *                              expectedCaseCount = how many cases this pass should
 *                              have run (all cases, or the pretest subset).
 * @returns {{ verdict, runtimeMs, memoryMB, testResults, failedTestCase, compileError }}
 * @throws {JudgeInfraError} when the outcome cannot be judged (→ status ERROR)
 */
function assembleVerdict(compile, run, problem, opts = {}) {
  if (!compile || compile.ok === false) {
    return {
      verdict: 'CE',
      runtimeMs: compile ? compile.ms || 0 : 0,
      memoryMB: 0,
      testResults: [],
      failedTestCase: null,
      compileError: (compile && compile.stderr) || 'compilation failed',
    };
  }

  const cases = (run && run.cases) || [];
  const testCases = problem.testCases || [];
  const checkerType = problem.checkerType || 'exact';

  const testResults = [];
  let runtimeMs = 0;
  let memoryMB = 0;
  let finalVerdict = 'AC';
  let failedTestCase = null;

  for (const c of cases) {
    runtimeMs = Math.max(runtimeMs, c.wall_ms || 0);
    memoryMB = Math.max(memoryMB, c.mem_mb || 0);
    const tc = testCases[c.index] || {};

    let caseVerdict;
    if (c.status === 'OK') {
      let check;
      try {
        // `opts.checkCase` (special checker, precomputed by the worker) overrides
        // the built-in exact/float dispatch.
        check = opts.checkCase
          ? opts.checkCase(c.index, b64(c.stdout_b64))
          : checkOne(checkerType, b64(c.stdout_b64), tc.expectedOutput, {
              input: tc.input, problem, opts: opts.floatOpts,
            });
      } catch (err) {
        if (err instanceof SpecialCheckerNotImplementedError) throw new JudgeInfraError(err.message);
        throw err;
      }
      if (!check || check.accepted === undefined) {
        throw new JudgeInfraError((check && check.message) || 'checker could not judge');
      }
      caseVerdict = check.accepted ? 'AC' : 'WA';
    } else {
      caseVerdict = STATUS_VERDICT[c.status] || 'RE';
    }

    testResults.push({
      testCaseIndex: c.index,
      verdict: caseVerdict,
      runtimeMs: c.wall_ms || 0,
      memoryMB: c.mem_mb || 0,
    });

    if (caseVerdict !== 'AC') {
      finalVerdict = caseVerdict;
      failedTestCase = {
        index: c.index,
        input: tc.input ?? '',
        expectedOutput: tc.expectedOutput ?? '',
        actualOutput: c.status === 'OK'
          ? b64(c.stdout_b64)
          : (b64(c.stderr_b64) || `(${c.status})`),
      };
      break;
    }
  }

  // Sanity: an AC verdict must mean every case this pass was meant to run passed.
  const expected = opts.expectedCaseCount ?? testCases.length;
  if (finalVerdict === 'AC' && cases.length < expected) {
    throw new JudgeInfraError(`AC but only ${cases.length}/${expected} cases were executed`);
  }

  return { verdict: finalVerdict, runtimeMs, memoryMB, testResults, failedTestCase, compileError: null };
}

module.exports = { assembleVerdict, JudgeInfraError };

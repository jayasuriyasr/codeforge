'use strict';

// ── Judge worker (v4) ───────────────────────────────────────────────────────
// Stateless. Per job:
//   acquire a fresh ephemeral sandbox → compile → run every test case (each with
//   its own timeout + memory measurement, in the supervisor) → assemble the
//   verdict → destroy the sandbox. No pool, no reuse, no per-container state.
//
// A verdict (AC/WA/TLE/MLE/RE/CE) is a SUCCESSFUL job. Only an infrastructure
// fault (sandbox vanished, daemon error, supervisor crash, checker cannot judge)
// throws — that lands the submission in status ERROR for operator attention.

const { Worker } = require('bullmq');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const Contest = require('../models/Contest');
const config = require('../config');
const { redis, bullConnection } = require('../redis');
const { assertProblemLimits, LOCK_DURATION_MS } = require('../utils/validation');
const {
  acquireSandbox, destroySandbox, execSupervisor, init: initSandbox, shutdown: shutdownSandbox,
} = require('../judge/sandbox');
const { assembleVerdict, JudgeInfraError } = require('../judge/verdict');
const { publishVerdict } = require('../realtime/publisher');
const { recordContestVerdict, recordGlobalSolve } = require('../leaderboard');

const { JavaExtractionError, JVM_OVERHEAD_MB } = require('../judge/languages/java');

// ── Build the supervisor job spec ──────────────────────────────────────────
// Throws JavaExtractionError when a Java submission has no discoverable entry
// class — the worker turns that into a CE verdict, not an infra fault.
function buildSpec(submission, problem, cases) {
  const lang = require(`../judge/languages/${submission.language}`);
  const isJava = submission.language === 'java';
  const arg = isJava ? submission.code : submission.language;
  const cmds = lang.getCommands(arg, { memoryLimitMB: problem.memoryLimitMB });

  return {
    source_filename: lang.sourceFileName(arg),
    source_b64: Buffer.from(submission.code, 'utf8').toString('base64'),
    compile_cmd: cmds.compileCmd || null,
    run_cmd: cmds.runCmd,
    time_limit_ms: Math.round(problem.timeLimitSec * 1000),
    memory_limit_mb: problem.memoryLimitMB,
    // Extra RSS the checker tolerates before calling MLE — the JVM needs room for
    // metaspace / JIT / GC on top of the heap; everyone else gets a small margin
    // to absorb RSS-measurement granularity.
    mle_slack_mb: isJava ? JVM_OVERHEAD_MB : 8,
    compile_timeout_ms: config.judge.compileTimeoutMs,
    output_cap_bytes: 64 * 1024 * 1024,
    stop_on_first_fail: true,
    cases: cases.map((tc, i) => ({
      index: tc._idx ?? i,      // REAL index into problem.testCases
      input_b64: Buffer.from(tc.input || '', 'utf8').toString('base64'),
    })),
  };
}

// Which test cases run this pass.
//   pretest pass (contest live, problem has pretests) → samples + pretests only
//   otherwise (practice, system test, contest with no pretests)  → every case
// Returns the ORIGINAL indices too, so verdict assembly and failedTestCase map
// back to the real test-case numbers the admin sees.
function casesFor(problem, { pretestOnly } = {}) {
  const all = problem.testCases || [];
  if (!pretestOnly) return all.map((tc, i) => ({ ...tc, _idx: i }));
  return all
    .map((tc, i) => ({ ...tc, _idx: i }))
    .filter((tc) => tc.isSample || tc.pretest);
}

function problemHasPretests(problem) {
  return (problem.testCases || []).some((tc) => tc.pretest);
}

// Reveal a failing case's I/O only when it is public (practice, or a contest
// sample). For a private contest case the user learns the case number and the
// verdict — never the data.
function shapeFailed(failed, problem) {
  if (!failed) return null;
  const tc = (problem.testCases || [])[failed.index];
  const isPublic = problem.mode !== 'contest' || (tc && tc.isSample);
  if (!isPublic) return {};   // private — nothing revealed
  return {
    input: failed.input,
    expectedOutput: failed.expectedOutput,
    actualOutput: failed.actualOutput,
  };
}

// ── Special (custom) checker — compiled + run in its own sandbox ────────────
async function runSpecialChecker(problem, cases, run) {
  const okCases = (run.cases || []).filter((c) => c.status === 'OK');
  if (okCases.length === 0) return new Map();

  const lang = require(`../judge/languages/${problem.checker.language}`);
  const cmds = lang.getCommands(problem.checker.language);
  const spec = {
    checker_source_filename: lang.sourceFileName(problem.checker.language),
    checker_source_b64: Buffer.from(problem.checker.source, 'utf8').toString('base64'),
    checker_compile_cmd: cmds.compileCmd || null,
    checker_run_cmd: `${cmds.runCmd} /workspace/in /workspace/out /workspace/exp`,
    compile_timeout_ms: config.judge.compileTimeoutMs,
    time_limit_ms: 10_000,
    cases: okCases.map((c) => ({
      index: c.index,
      input_b64: Buffer.from(problem.testCases[c.index].input || '', 'utf8').toString('base64'),
      output_b64: c.stdout_b64,
      expected_b64: Buffer.from(problem.testCases[c.index].expectedOutput || '', 'utf8').toString('base64'),
    })),
  };

  const sandbox = await acquireSandbox();
  try {
    const res = await execSupervisor(sandbox, 'check', spec, {
      timeoutMs: config.judge.compileTimeoutMs + okCases.length * 11_000 + 10_000,
    });
    if (res.compile && res.compile.ok === false) {
      throw new JudgeInfraError(`special checker failed to compile: ${res.compile.stderr}`);
    }
    return new Map((res.cases || []).map((r) => [r.index, { accepted: !!r.accepted, message: r.message }]));
  } finally {
    destroySandbox(sandbox);
  }
}

// ── Run one submission inside a fresh sandbox ───────────────────────────────
async function judge(submission, problem, { pretestOnly = false } = {}) {
  const cases = casesFor(problem, { pretestOnly });

  let spec;
  try {
    spec = buildSpec(submission, problem, cases);
  } catch (err) {
    if (err instanceof JavaExtractionError) {
      return assembleVerdict({ ok: false, ms: 0, stderr: err.message }, null, problem);
    }
    throw err;
  }

  const sandbox = await acquireSandbox();
  let compile, run = null;
  try {
    await Submission.findByIdAndUpdate(submission._id, { status: 'COMPILING' });
    ({ compile } = await execSupervisor(sandbox, 'compile', spec, {
      timeoutMs: config.judge.compileTimeoutMs + 5_000,
    }));

    if (compile.ok) {
      await Submission.findByIdAndUpdate(submission._id, { status: 'RUNNING' });
      const guardMs = cases.length * (spec.time_limit_ms + 1_000) + 15_000;
      run = await execSupervisor(sandbox, 'run', spec, { timeoutMs: guardMs });
    }
  } finally {
    destroySandbox(sandbox);
  }

  let checkCase;
  if (compile.ok && run && problem.checkerType === 'special') {
    if (!problem.checker || !problem.checker.source || !problem.checker.language) {
      throw new JudgeInfraError('problem uses checkerType "special" but has no checker source');
    }
    const results = await runSpecialChecker(problem, cases, run);
    checkCase = (index) => results.get(index) || { accepted: false, message: 'no checker result for this case' };
  }

  return assembleVerdict(compile, run, problem, { expectedCaseCount: cases.length, checkCase });
}

// First AC on a problem bumps the global (distinct-problems-solved) board once.
async function maybeRecordGlobalSolve(submission) {
  const prior = await Submission.findOne({
    userId: submission.userId,
    problemId: submission.problemId,
    verdict: 'AC',
    _id: { $ne: submission._id },
  }).select('_id').lean();
  if (!prior) await recordGlobalSolve(submission.userId);
}

// ── Job processor ──────────────────────────────────────────────────────────
async function processJob(job) {
  const { submissionId, systemTest = false } = job.data;
  const submission = await Submission.findById(submissionId);
  if (!submission) return;                       // submission deleted — drop the job

  try {
    const problem = await Problem.findById(submission.problemId).lean();
    if (!problem) throw new JudgeInfraError(`problem ${submission.problemId} not found`);
    assertProblemLimits(problem);

    // Contest context — decide pretest vs full run.
    let contest = null;
    if (submission.contestId) {
      contest = await Contest.findById(submission.contestId).select('startTime endTime').lean();
    }
    const contestLive = contest && new Date() <= new Date(contest.endTime);
    const pretestOnly = !systemTest && contestLive && problemHasPretests(problem);

    const result = await judge(submission, problem, { pretestOnly });
    const failed = shapeFailed(result.failedTestCase, problem);

    await Submission.findByIdAndUpdate(submissionId, {
      status: 'DONE',
      verdict: result.verdict,
      runtimeMs: result.runtimeMs,
      memoryMB: result.memoryMB,
      error: null,
      provisional: pretestOnly,
      compileError: result.compileError || undefined,
      testResults: result.testResults,
      ...(failed ? { failedTestCase: failed } : {}),
    });

    // Leaderboard — provisional pretest verdicts count during the contest; the
    // system-test pass rebuilds from Mongo afterwards.
    if (submission.contestId && contest && ['AC', 'WA', 'TLE', 'MLE', 'RE'].includes(result.verdict)) {
      await recordContestVerdict({
        contestId: submission.contestId,
        userId: submission.userId,
        problemId: submission.problemId,
        verdict: result.verdict,
        submittedAt: submission.createdAt,
        contestStart: contest.startTime,
      });
    }
    if (result.verdict === 'AC') await maybeRecordGlobalSolve(submission);

    await publishVerdict(submissionId, {
      status: 'DONE',
      verdict: result.verdict,
      runtimeMs: result.runtimeMs,
      memoryMB: result.memoryMB,
      provisional: pretestOnly,
      ...(failed && Object.keys(failed).length ? { failedTestCase: failed } : {}),
    });
  } catch (err) {
    const detail = String(err && err.message ? err.message : err).slice(0, 2048);
    await Submission.findByIdAndUpdate(submissionId, {
      status: 'ERROR', verdict: null, error: detail,
    }).catch(() => {});
    console.error(`[worker] infra fault on submission ${submissionId}:`, err);
    await publishVerdict(submissionId, { status: 'ERROR', verdict: null, error: detail }).catch(() => {});
    throw err;                                   // BullMQ failed-job path (attempts: 1)
  } finally {
    await redis.del(`inflight:${submission.userId}`).catch(() => {});
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
let worker = null;

/** Start consuming the queue. Called by index.js after Mongo connects. */
function start() {
  if (worker) return worker;
  worker = new Worker('submissions', processJob, {
    connection: bullConnection,
    concurrency: config.judge.concurrency,
    lockDuration: LOCK_DURATION_MS,
    stalledInterval: 30_000,
  });
  initSandbox().catch((e) => console.error('[worker] sandbox init failed:', e.message));
  console.log(`[worker] listening on "submissions" (concurrency ${config.judge.concurrency})`);
  return worker;
}

/** Graceful shutdown: stop taking jobs, finish the in-flight one, drop sandboxes. */
async function drain() {
  if (worker) { try { await worker.close(); } catch { /* ignore */ } }
  await shutdownSandbox();
}

module.exports = { start, drain, processJob, buildSpec, shapeFailed, judge, casesFor, problemHasPretests };

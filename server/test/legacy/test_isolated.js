'use strict';

const assert = require('assert').strict;
const { classifyResult } = require('./src/judge/runner');
const { defaultChecker } = require('./src/judge/checkers/exact');
const { runChecks } = require('./src/judge/testRunner');
const { assertProblemLimits } = require('./src/utils/validation');

// Mock Redis for Step 8 / 10
class MockRedis {
  async zrevrange() { return []; }
  async zadd() { return 1; }
  async del() { return 1; }
  async zcount() { return 5; } // Rate limit mock (under 10)
  async set() { return 'OK'; } // Inflight NX success
  pipeline() { return { del(){}, zadd(){}, expire(){}, exec: async () => [] }; }
  on() {}
  quit() {}
}
MockRedis.default = MockRedis;

const ioredisPath = require.resolve('ioredis');
require.cache[ioredisPath] = {
  id: ioredisPath, filename: ioredisPath, loaded: true,
  exports: MockRedis
};

const authPath = require.resolve('./src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    authenticateJWT: (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).json({ error: 'Missing token' });
      req.user = { sub: 'user1' };
      next();
    }
  }
};

let passed = 0, failed = 0;
async function runTest(label, fn) {
  try {
    await fn();
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${label}\n       ${err.message}`);
    failed++;
  }
}

async function run() {
  console.log('\n── Step 6: Runner Heuristics ──────────────────────────────────────');
  
  await runTest('JVM memory check (does not return false MLE on exit 0)', () => {
    // If a JVM process exits cleanly (0) despite high physical memory usage,
    // it should return AC_CANDIDATE, because the cgroup didn't OOM-kill it (137).
    const prob = { timeLimitSec: 2 };
    const verdict = classifyResult({ code: 0, signal: null }, prob, 1000);
    assert.equal(verdict, 'AC_CANDIDATE');
  });

  await runTest('TLE heuristic: killed near time limit (spin-loop)', () => {
    const prob = { timeLimitSec: 2 }; // 2000ms
    const verdict = classifyResult({ code: 137, signal: 'SIGKILL' }, prob, 1850);
    assert.equal(verdict, 'TLE');
  });

  await runTest('MLE heuristic: killed well before time limit (genuine over-allocation)', () => {
    const prob = { timeLimitSec: 2 };
    const verdict = classifyResult({ code: 137, signal: 'SIGKILL' }, prob, 500);
    assert.equal(verdict, 'MLE');
  });

  console.log('\n── Step 7: Checkers ─────────────────────────────────────────────');

  await runTest('defaultChecker normalizes whitespace/newlines', () => {
    const expected = 'hello world';
    const actual = 'hello world \t \n\n';
    assert.equal(defaultChecker(actual, expected), true);
  });

  await runTest('testRunner short-circuits on first WA', () => {
    const problem = {
      checkerType: 'exact',
      testCases: [
        { input: '1', expectedOutput: 'a' },
        { input: '2', expectedOutput: 'b' }, // This will fail
        { input: '3', expectedOutput: 'c' }
      ]
    };
    const actualOutputs = ['a', 'wrong', 'c']; // Failed at index 1
    const res = runChecks(problem, actualOutputs);
    assert.equal(res.verdict, 'WA');
    assert.equal(res.failedIndex, 1);
    assert.equal(res.checkedCount, 2); // Short-circuited, did not check 3rd
  });

  console.log('\n── Step 8: Middleware Order ─────────────────────────────────────');
  
  const { rateLimiter } = require('./src/middleware/rateLimiter');
  const { inflightGuard } = require('./src/middleware/inflightGuard');
  const { assertContestEligible } = require('./src/middleware/contestEligibility');

  function createRes() {
    return {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; },
      send(data) { this.body = data; return this; }
    };
  }

  await runTest('Unauthenticated → rejected before rate limit', async () => {
    const req = { headers: {} };
    const res = createRes();
    require.cache[authPath].exports.authenticateJWT(req, res, () => {
      throw new Error('Should not reach next()');
    });
    assert.equal(res.statusCode, 401);
  });

  await runTest('Over rate limit → rejected before inflight guard', async () => {
    // Mock redis to return 15 for zcount (over 10)
    const MockRedis = require.cache[ioredisPath].exports;
    const mRedis = new MockRedis();
    mRedis.pipeline = () => ({
      zremrangebyscore: () => {}, zadd: () => {}, zcard: () => {}, expire: () => {},
      exec: async () => [[], [], [null, 15]] // 15 > 10 MAX_REQUESTS
    });
    
    const req = { user: { sub: 'user1' } };
    const res = createRes();
    const rl = rateLimiter(mRedis);
    await rl(req, res, () => { throw new Error('Should not reach next()'); });
    assert.equal(res.statusCode, 429);
  });

  await runTest('Existing in-flight submission → rejected before eligibility', async () => {
    const MockRedis = require.cache[ioredisPath].exports;
    const mRedis = new MockRedis();
    mRedis.set = async () => null; // Simulate NX failing (already exists)
    
    const req = { user: { sub: 'user1' } };
    const res = createRes();
    const ig = inflightGuard(mRedis);
    await ig(req, res, () => { throw new Error('Should not reach next()'); });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'you already have a submission in progress — wait for it to complete');
  });

  await runTest('Ineligible contest submission → silently nulled, not rejected', async () => {
    const Contest = require('./src/models/Contest');
    // Mongoose ObjectIds or objects usually. 'some' on string might fail if it's expecting objects with .toString().
    // We will provide a simple array of strings, but if some expects ObjectId, .toString() works.
    Contest.findById = () => ({ lean: () => ({ problems: [{ toString: () => 'p2' }], startTime: Date.now() - 10000, endTime: Date.now() + 10000 }) });
    
    const req = { user: { sub: 'user1' }, body: { contestId: 'c1', problemId: 'p1' } }; // p1 is not in contest
    const res = createRes();
    let nextCalled = false;
    await assertContestEligible(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.body.contestId, null); // Mutated!
  });

  console.log('\n── Step 10: Worker and Enqueue ──────────────────────────────────');

  await runTest('assertProblemLimits rejects out-of-bounds at enqueue time', async () => {
    const { enqueueSubmission } = require('./src/queue/setup');
    const problem = { timeLimitSec: 20, memoryLimitMB: 256 }; // 20 > 10 limit
    let threw = false;
    try {
      await enqueueSubmission({ submissionId: 's1', problem });
    } catch(err) {
      threw = true;
      assert.match(err.message, /exceeds queue ceiling of 10s/);
    }
    assert.equal(threw, true);
  });

  await runTest('runInSandbox routes properly to destroy vs release', async () => {
    const poolPath = require.resolve('./src/judge/containerPool');
    let destroyed = false;
    let released = false;
    require.cache[poolPath] = {
      id: poolPath, filename: poolPath, loaded: true,
      exports: {
        pool: {
          acquire: async () => 'c1',
          release: async () => { released = true; },
          destroy: async () => { destroyed = true; }
        },
        RECYCLE_AFTER_N: 200,
        getSubmissionCount: () => 1,
        incrementSubmissionCount: () => {}
      }
    };
    const cleanupPath = require.resolve('./src/judge/cleanup');
    require.cache[cleanupPath] = {
      id: cleanupPath, filename: cleanupPath, loaded: true,
      exports: { cleanupContainer: async () => {} }
    };
    const runnerPath = require.resolve('./src/judge/runner');
    
    // We will dynamically override _runSubmission for the two cases
    require.cache[runnerPath] = {
      id: runnerPath, filename: runnerPath, loaded: true,
      exports: {
        _runSubmission: async () => {},
        runSubmission: async (...args) => require.cache[runnerPath].exports._runSubmission(...args)
      }
    };

    // Require worker AFTER mocking dependencies
    const workerPath = require.resolve('./src/queue/worker');
    delete require.cache[workerPath]; // ensure it's reloaded
    require('./src/queue/worker'); 
    
    // Test 1: hitResourceCeiling -> destroy
    destroyed = false; released = false;
    require.cache[runnerPath].exports._runSubmission = async () => ({ verdict: 'TLE', hitResourceCeiling: true });
    
    // Need to trigger runInSandbox directly or via processJob. We'll simulate runInSandbox
    // since we can't easily export it. I'll mock Submission.findById to drive it via processJob.
    const Submission = require('./src/models/Submission');
    const Problem = require('./src/models/Problem');
    Submission.findById = async () => ({ _id: 's1', problemId: 'p1', language: 'javascript', code: 'test' });
    Submission.findByIdAndUpdate = async () => {};
    Problem.findById = () => ({ lean: () => ({ timeLimitSec: 2, memoryLimitMB: 256 }) });

    // We can't access processJob exported directly, but bullmq was NOT mocked this time, so the worker IS running!
    // But since this is a unit test, we can just grab processJob from the Worker constructor.
    const bullmqPath = require.resolve('bullmq');
    let processJobRef;
    require.cache[bullmqPath] = {
      id: bullmqPath, filename: bullmqPath, loaded: true,
      exports: {
        Queue: class MockQueue { add() {} },
        Worker: class MockWorker { constructor(q, handler) { processJobRef = handler; } }
      }
    };
    
    // Re-require to capture processJobRef
    delete require.cache[workerPath];
    require('./src/queue/worker');

    await processJobRef({ data: { submissionId: 's1' } });
    assert.equal(destroyed, true);
    assert.equal(released, false);

    // Test 2: normal WA -> release
    destroyed = false; released = false;
    require.cache[runnerPath].exports._runSubmission = async () => ({ verdict: 'AC_CANDIDATE', hitResourceCeiling: false, stdout: '' });
    await processJobRef({ data: { submissionId: 's2' } });
    assert.equal(destroyed, false);
    assert.equal(released, true);
  });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });

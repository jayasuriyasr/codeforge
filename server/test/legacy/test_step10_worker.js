'use strict';

const mockRequire = require('module');
const EventEmitter = require('events');

let passed = 0, failed = 0;
async function assert(label, fn) {
  try   { await fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.stack}`); failed++; }
}

async function run() {
  const deletedKeys = [];
  const ioredisPath = require.resolve('ioredis');
  require.cache[ioredisPath] = {
    id: ioredisPath, filename: ioredisPath, loaded: true,
    exports: class MockRedis {
      zrevrange() { return []; }
      pipeline() { return { del(){}, zadd(){}, expire(){}, exec: async () => [] }; }
      async del(key) { deletedKeys.push(key); return 1; }
      async zadd() { return 1; }
      async zincrby() { return 1; }  // leaderboard increment after AC
      on() {}
      quit() {}
    }
  };

  const bullmqPath = require.resolve('bullmq');
  let processJobRef = null;
  require.cache[bullmqPath] = {
    id: bullmqPath, filename: bullmqPath, loaded: true,
    exports: {
      Queue: class MockQueue { add() {} },
      Worker: class MockWorker { constructor(q, handler) { processJobRef = handler; } }
    }
  };

  const runnerPath = require.resolve('./src/judge/runner');
  const mockRunner = {
    _runSubmission: async () => ({ verdict: 'AC_CANDIDATE', durationMs: 100, stdout: '', stderr: '' }),
    runSubmission: async (...args) => mockRunner._runSubmission(...args)
  };
  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true,
    exports: mockRunner
  };

  const poolPath = require.resolve('./src/judge/containerPool');
  const mockPool = {
    acquire: async () => 'c1',
    release: async () => {},
    destroy: async () => {},
  };
  require.cache[poolPath] = {
    id: poolPath, filename: poolPath, loaded: true,
    exports: {
      pool: mockPool,
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
  
  // Need to mock DB
  const Submission = require('./src/models/Submission');
  const Problem = require('./src/models/Problem');

  // Let's require the worker so processJobRef gets populated
  require('./src/queue/worker');

  // Test 1: Full lifecycle
  console.log('\n── Worker Lifecycle ───────────────────────────────────────────────');

  await assert('transitions QUEUED → RUNNING → COMPLETED', async () => {
    let statusUpdates = [];
    Submission.findById = async (id) => ({ _id: id, problemId: 'p1', userId: 'u1', language: 'javascript', code: 'test' });
    Submission.findByIdAndUpdate = async (id, update) => {
      statusUpdates.push(update.status);
    };
    Submission.findOne = () => ({ lean: async () => null });  // no prior AC — chainable .lean()
    Problem.findById = () => ({ lean: async () => ({ timeLimitSec: 2, memoryLimitMB: 256, testCases: [] }) });
    
    let containerAcquired = false;
    let released = false;
    mockPool.acquire = async () => { containerAcquired = true; return 'c1'; };
    mockPool.release = async () => { released = true; };
    mockPool.destroy = async () => {};
    
    mockRunner._runSubmission = async () => ({ verdict: 'AC_CANDIDATE', durationMs: 100, stdout: '', stderr: '' });

    const job = { data: { submissionId: 's1' } };
    await processJobRef(job);

    if (!containerAcquired) throw new Error('Container not acquired');
    if (!statusUpdates.includes('RUNNING')) throw new Error('Did not transition to RUNNING');
    if (!statusUpdates.includes('COMPLETED')) throw new Error('Did not transition to COMPLETED');
    if (!released) throw new Error('Container not released');
  });

  await assert('TLE does not release, but destroys container', async () => {
    let destroyed = false;
    mockPool.acquire = async () => 'c2';
    mockPool.release = async () => { throw new Error('Should not release!'); };
    mockPool.destroy = async () => { destroyed = true; };

    mockRunner._runSubmission = async (c, job) => {
      // Return hitResourceCeiling so finally block destroys it
      return { verdict: 'TLE', durationMs: 2000, hitResourceCeiling: true, stdout: '', stderr: '' };
    };

    const job = { data: { submissionId: 's2' } };
    await processJobRef(job);
    
    if (!destroyed) throw new Error('Container was not destroyed');
  });

  await assert('inflight guard is released even when job throws', async () => {
    Submission.findById = async () => ({ _id: 's3', userId: 'u3' });
    Problem.findById = () => ({ lean: () => { throw new Error('Simulated infra/db failure'); } });

    const { redis } = require('./src/queue/setup'); // or any module that instantiates it, it's mocked anyway
    // Wait, worker instantiates its own redis
    // But MockRedis captures deleted keys globally for this test because we mock prototype.
    const MockRedis = require.cache[ioredisPath].exports;
    MockRedis.prototype.deleted = [];

    const job = { data: { submissionId: 's3' } };
    try {
      await processJobRef(job);
    } catch(err) {}

    if (!deletedKeys.includes('inflight:u3')) throw new Error('Inflight guard not released: ' + deletedKeys);
  });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });

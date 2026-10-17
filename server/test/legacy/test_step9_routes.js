'use strict';

const express = require('express');

// Helper to return a dummy middleware
function mockMiddleware() { return (req, res, next) => next(); }

// Mock ioredis before anything else is required
const ioredisPath = require.resolve('ioredis');
require.cache[ioredisPath] = {
  id: ioredisPath,
  filename: ioredisPath,
  loaded: true,
  exports: class MockRedis {
    zrevrange() { return []; }
    pipeline() { return { del(){}, zadd(){}, expire(){}, exec: async () => [] }; }
    on() {}
    quit() {}
  }
};

// Mock middlewares before routing requires them
const authPath = require.resolve('./src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    authenticateJWT: (req, res, next) => { req.user = { sub: 'mockUserId', role: 'admin' }; next(); },
    requireRole: () => mockMiddleware()
  }
};

const rlPath = require.resolve('./src/middleware/rateLimiter');
require.cache[rlPath] = { id: rlPath, filename: rlPath, loaded: true, exports: { rateLimiter: () => mockMiddleware() } };

const igPath = require.resolve('./src/middleware/inflightGuard');
require.cache[igPath] = { id: igPath, filename: igPath, loaded: true, exports: { inflightGuard: () => mockMiddleware() } };

const cePath = require.resolve('./src/middleware/contestEligibility');
require.cache[cePath] = { id: cePath, filename: cePath, loaded: true, exports: { assertContestEligible: mockMiddleware() } };

// Mock queue/setup so BullMQ never tries to connect to Redis in these unit tests
const queueSetupPath = require.resolve('./src/queue/setup');
require.cache[queueSetupPath] = {
  id: queueSetupPath, filename: queueSetupPath, loaded: true,
  exports: { enqueueSubmission: async () => {}, submissionQueue: null, redis: null }
};

const submissionsRouter = require('./src/routes/submissions');
const problemsRouter = require('./src/routes/problems');
const leaderboardRouter = require('./src/routes/leaderboard');
const Submission = require('./src/models/Submission');
const Problem = require('./src/models/Problem');

let passed = 0, failed = 0;

async function assert(label, fn) {
  try   { await fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.stack}`); failed++; }
}

async function run() {
  function createRes(resolve) {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; resolve(res); return this; },
      end() { resolve(res); return this; }
    };
    return res;
  }

  const origSubmissionCreate = Submission.create;
  const origSubmissionFindById = Submission.findById;
  const origSubmissionAggregate = Submission.aggregate;

  // ── Test: Submissions Idempotency ──────────────────────────────────────────
  console.log('\n── Submissions Idempotency (Phase 2 Pattern) ─────────────────────');

  await assert('first submission succeeds', async () => {
    Submission.create = async (doc) => ({ ...doc, _id: doc._id || 'new-id' });
    // Mock Problem.findById so the route can resolve a problem for enqueueSubmission
    const origProblemFindById = Problem.findById;
    Problem.findById = (id) => ({
      lean: async () => ({ _id: id, title: 'Mock', timeLimitSec: 2, memoryLimitMB: 256, testCases: [] })
    });
    const req = { url: '/', method: 'POST', headers: { 'idempotency-key': 'key-1' }, body: { problemId: 'p1', code: 'test', language: 'python' } };
    
    const res = await new Promise((resolve, reject) => {
      submissionsRouter(req, createRes(resolve), (err) => reject(err));
    });
    Problem.findById = origProblemFindById; // restore

    if (res.statusCode !== 201) throw new Error(`Status: ${res.statusCode}`);
    if (res.body.submission.status !== 'QUEUED') throw new Error(`Status: ${res.body.submission.status}`);
  });

  await assert('duplicate submission (11000) swallows error and returns original', async () => {
    Submission.create = async () => { const err = new Error('E11000 duplicate'); err.code = 11000; throw err; };
    Submission.findById = async (id) => ({ _id: id, status: 'QUEUED', original: true });

    const req = { url: '/', method: 'POST', headers: { 'idempotency-key': 'key-dup' }, body: { problemId: 'p1', code: 'test', language: 'python' } };
    const res = await new Promise((resolve, reject) => {
      submissionsRouter(req, createRes(resolve), (err) => reject(err));
    });

    if (res.statusCode !== 201) throw new Error(`Status: ${res.statusCode}`);
    if (res.body.submission.original !== true) throw new Error('Did not return original submission');
  });

  await assert('other DB errors are NOT swallowed', async () => {
    Submission.create = async () => { const err = new Error('DB error'); err.code = 12345; throw err; };

    const req = { url: '/', method: 'POST', headers: { 'idempotency-key': 'key-err' }, body: { problemId: 'p1', code: 'test', language: 'python' } };
    let thrown = false;
    try {
      await new Promise((resolve, reject) => {
        submissionsRouter(req, createRes(resolve), (err) => err ? reject(err) : resolve());
      });
    } catch(err) { thrown = true; }
    
    if (!thrown) throw new Error('Error was swallowed!');
  });

  // ── Test: Problem Limits ───────────────────────────────────────────────────
  console.log('\n── Problem CRUD Validation ───────────────────────────────────────');

  await assert('creating problem with timeLimitSec=15 is rejected', async () => {
    const req = { url: '/', method: 'POST', headers: {}, body: { title: 'Test', timeLimitSec: 15, memoryLimitMB: 256, checkerType: 'exact', testCases: [] } };
    
    const res = await new Promise((resolve, reject) => {
      problemsRouter(req, createRes(resolve), (err) => err ? reject(err) : resolve());
    });

    if (res.statusCode !== 400) throw new Error(`Status: ${res.statusCode}`);
    if (!res.body.error.includes('exceeds queue ceiling of 10s')) throw new Error(`Message: ${res.body.error}`);
  });

  // ── Test: Leaderboard Fallback ─────────────────────────────────────────────
  console.log('\n── Leaderboard Fallback ──────────────────────────────────────────');

  await assert('leaderboard falls back to Mongo if Redis is empty', async () => {
    Submission.aggregate = async () => [ { userId: 'u1', score: 3 }, { userId: 'u2', score: 1 } ];

    const req = { url: '/', method: 'GET', headers: {} };
    const res = await new Promise((resolve, reject) => {
      leaderboardRouter(req, createRes(resolve), (err) => err ? reject(err) : resolve());
    });

    if (res.statusCode !== 200) throw new Error(`Status: ${res.statusCode}`);
    if (res.body.source !== 'mongodb') throw new Error(`Source: ${res.body.source}`);
    if (res.body.leaderboard[0].userId !== 'u1') throw new Error(`Top user: ${res.body.leaderboard[0].userId}`);
  });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });

'use strict';

// ── Acceptance test — Phase 2 Middleware ──────────────────────────────────────

const { authenticateJWT, requireRole } = require('./src/middleware/auth');
const { rateLimiter } = require('./src/middleware/rateLimiter');
const { inflightGuard } = require('./src/middleware/inflightGuard');
const { assertContestEligible } = require('./src/middleware/contestEligibility');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

let passed = 0, failed = 0;

async function assert(label, fn) {
  try   { await fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.message}`); failed++; }
}

async function run() {
  // ── Mock Express res/next ─────────────────────────────────────────────────────
  function createRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; return this; }
    };
    return res;
  }

  // ── Mock Redis ────────────────────────────────────────────────────────────────
  class MockRedis {
    constructor() {
      this.zsets = new Map();
      this.keys = new Map();
    }

    pipeline() {
      const pipe = {
        results: [],
        zremrangebyscore: (k, min, max) => {
          if (!this.zsets.has(k)) this.zsets.set(k, []);
          this.zsets.set(k, this.zsets.get(k).filter(item => item.score < min || item.score > max));
          pipe.results.push([null, 'OK']);
          return pipe;
        },
        zadd: (k, score, member) => {
          if (!this.zsets.has(k)) this.zsets.set(k, []);
          this.zsets.get(k).push({ score, member });  // always add — unique member per request
          pipe.results.push([null, 1]);
          return pipe;
        },
        zcard: (k) => {
          const count = this.zsets.has(k) ? this.zsets.get(k).length : 0;
          pipe.results.push([null, count]);
          return pipe;
        },
        expire: (k, ttl) => {
          pipe.results.push([null, 1]);
          return pipe;
        },
        exec: async () => pipe.results
      };
      return pipe;
    }

    async set(key, val, nx, ex, ttl) {
      if (this.keys.has(key)) return null;
      this.keys.set(key, val);
      return 'OK';
    }

    async del(key) {
      this.keys.delete(key);
      return 1;
    }
  }

  // ── Mock Mongoose ─────────────────────────────────────────────────────────────
  const Contest = require('./src/models/Contest');
  const mongoose = require('mongoose');
  const originalFindById = Contest.findById;

  // ── authenticateJWT ───────────────────────────────────────────────────────────
  console.log('\n── authenticateJWT ────────────────────────────────────────────────');

  await assert('no token → 401', () => {
    const req = { headers: {} }, res = createRes();
    let nextCalled = false;
    authenticateJWT(req, res, () => { nextCalled = true; });
    if (nextCalled) throw new Error('next() was called');
    if (res.statusCode !== 401) throw new Error(`status=${res.statusCode}`);
  });

  await assert('valid token → attaches req.user and calls next', () => {
    const token = jwt.sign({ sub: 'user123', role: 'contestant' }, JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } }, res = createRes();
    let nextCalled = false;
    authenticateJWT(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() was not called');
    if (req.user.sub !== 'user123') throw new Error(`sub=${req.user.sub}`);
    if (req.user.role !== 'contestant') throw new Error(`role=${req.user.role}`);
  });

  // ── requireRole ───────────────────────────────────────────────────────────────
  console.log('\n── requireRole ────────────────────────────────────────────────────');

  await assert('not admin → 403', () => {
    const req = { user: { role: 'contestant' } }, res = createRes();
    let nextCalled = false;
    requireRole('admin')(req, res, () => { nextCalled = true; });
    if (nextCalled) throw new Error('next() was called');
    if (res.statusCode !== 403) throw new Error(`status=${res.statusCode}`);
  });

  // ── rateLimiter ───────────────────────────────────────────────────────────────
  console.log('\n── rateLimiter ────────────────────────────────────────────────────');

  const _redis = new MockRedis();
  const rlMiddleware = rateLimiter(_redis);

  await assert('under limit → calls next', async () => {
    const req = { user: { sub: 'u1' } }, res = createRes();
    let nextCalled = false;
    await rlMiddleware(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
  });

  await assert('over limit → 429', async () => {
    const req = { user: { sub: 'u2' } }, res = createRes();
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 20)); // 20ms: survives Windows 15ms timer resolution
      await rlMiddleware(req, res, () => {});
    }
    let nextCalled = false;
    await rlMiddleware(req, res, () => { nextCalled = true; });
    if (nextCalled) throw new Error('next() was called, should be rate limited');
    if (res.statusCode !== 429) throw new Error(`status=${res.statusCode}`);
  });

  // ── inflightGuard ─────────────────────────────────────────────────────────────
  console.log('\n── inflightGuard ──────────────────────────────────────────────────');

  const igMiddleware = inflightGuard(_redis);

  await assert('no existing submission → acquires lock, calls next', async () => {
    const req = { user: { sub: 'u3' } }, res = createRes();
    let nextCalled = false;
    await igMiddleware(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
    if (typeof req.releaseInflightSlot !== 'function') throw new Error('release function not attached');
  });

  await assert('existing submission → 409', async () => {
    const req = { user: { sub: 'u3' } }, res = createRes();
    let nextCalled = false;
    await igMiddleware(req, res, () => { nextCalled = true; });
    if (nextCalled) throw new Error('next() was called, should be blocked');
    if (res.statusCode !== 409) throw new Error(`status=${res.statusCode}`);
  });

  await assert('release slot works', async () => {
    const req = { user: { sub: 'u4' } }, res = createRes();
    await igMiddleware(req, res, () => {});
    await req.releaseInflightSlot();
    let nextCalled = false;
    await igMiddleware(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called after release');
  });


  // ── contestEligibility ────────────────────────────────────────────────────────
  console.log('\n── contestEligibility ─────────────────────────────────────────────');

  Contest.findById = (id) => ({
    lean: () => Promise.resolve({
      _id: id,
      startTime: new Date(Date.now() - 10000), // 10 seconds ago
      endTime: new Date(Date.now() + 10000),   // 10 seconds from now
      problemIds: [new mongoose.Types.ObjectId('507f191e810c19729de860ea')]
    })
  });

  await assert('eligible submission → contestId remains', async () => {
    const req = { body: { contestId: 'c1', problemId: '507f191e810c19729de860ea' } };
    let nextCalled = false;
    await assertContestEligible(req, createRes(), () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
    if (req.body.contestId !== 'c1') throw new Error(`contestId=${req.body.contestId}`);
  });

  await assert('ineligible (wrong problem) → contestId nullified', async () => {
    const req = { body: { contestId: 'c1', problemId: '507f191e810c19729de860eb' } }; // different problemId
    let nextCalled = false;
    await assertContestEligible(req, createRes(), () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
    if (req.body.contestId !== null) throw new Error(`contestId=${req.body.contestId}`);
  });

  await assert('ineligible (contest ended) → contestId nullified', async () => {
    Contest.findById = (id) => ({
      lean: () => Promise.resolve({
        _id: id,
        startTime: new Date(Date.now() - 20000),
        endTime: new Date(Date.now() - 10000), // Ended 10s ago
        problemIds: [new mongoose.Types.ObjectId('507f191e810c19729de860ea')]
      })
    });
    const req = { body: { contestId: 'c1', problemId: '507f191e810c19729de860ea' } };
    let nextCalled = false;
    await assertContestEligible(req, createRes(), () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
    if (req.body.contestId !== null) throw new Error(`contestId=${req.body.contestId}`);
  });

  await assert('contest not found → contestId nullified', async () => {
    Contest.findById = (id) => ({
      lean: () => Promise.resolve(null)
    });
    const req = { body: { contestId: 'c1', problemId: '507f191e810c19729de860ea' } };
    let nextCalled = false;
    await assertContestEligible(req, createRes(), () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
    if (req.body.contestId !== null) throw new Error(`contestId=${req.body.contestId}`);
  });

  await assert('no contestId (casual practice) → skipped', async () => {
    const req = { body: { problemId: 'p1' } };
    let nextCalled = false;
    await assertContestEligible(req, createRes(), () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() not called');
    if (req.body.contestId !== undefined) throw new Error(`contestId=${req.body.contestId}`);
  });

  // Restore mock
  Contest.findById = originalFindById;

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

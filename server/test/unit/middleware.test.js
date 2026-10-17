'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
const config = require('../../src/config');
const { authenticateJWT, requireRole } = require('../../src/middleware/auth');
const { slidingWindow, rateLimiter } = require('../../src/middleware/rateLimiter');
const { inflightGuard } = require('../../src/middleware/inflightGuard');
const { assertContestEligible } = require('../../src/middleware/contestEligibility');

// ── minimal express double ──────────────────────────────────────────────────
function mkRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
  };
}

// ── auth ────────────────────────────────────────────────────────────────────
test('authenticateJWT: valid Bearer token populates req.user', () => {
  const token = jwt.sign({ sub: 'u1', role: 'contestant' }, config.jwt.secret);
  const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
  const res = mkRes();
  let nexted = false;
  authenticateJWT(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.equal(req.user.sub, 'u1');
});

test('authenticateJWT: missing token → 401', () => {
  const res = mkRes();
  authenticateJWT({ headers: {}, query: {} }, res, () => assert.fail('should not next'));
  assert.equal(res.statusCode, 401);
});

test('authenticateJWT: token via ?token= query (for EventSource) works', () => {
  const token = jwt.sign({ sub: 'u2', role: 'admin' }, config.jwt.secret);
  const req = { headers: {}, query: { token } };
  const res = mkRes();
  let nexted = false;
  authenticateJWT(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.equal(req.user.role, 'admin');
});

test('requireRole: non-admin → 403', () => {
  const res = mkRes();
  requireRole('admin')({ user: { role: 'contestant' } }, res, () => assert.fail('should not next'));
  assert.equal(res.statusCode, 403);
});

// ── rate limiter (fake redis) ───────────────────────────────────────────────
function fakeRedisReturning(zcard) {
  return {
    pipeline() {
      const chain = {
        zremrangebyscore() { return chain; },
        zadd() { return chain; },
        zcard() { return chain; },
        expire() { return chain; },
        exec: async () => [[null, 0], [null, 1], [null, zcard], [null, 1]],
      };
      return chain;
    },
  };
}

test('rateLimiter: under the limit calls next', async () => {
  const mw = slidingWindow({ keyPrefix: 't:', windowSec: 60, max: 10, keyFn: () => 'u', redis: fakeRedisReturning(5) });
  const res = mkRes();
  let nexted = false;
  await mw({ user: { sub: 'u' } }, res, () => { nexted = true; });
  assert.ok(nexted);
});

test('rateLimiter: over the limit → 429', async () => {
  const mw = slidingWindow({ keyPrefix: 't:', windowSec: 60, max: 10, keyFn: () => 'u', redis: fakeRedisReturning(11) });
  const res = mkRes();
  await mw({ user: { sub: 'u' } }, res, () => assert.fail('should not next'));
  assert.equal(res.statusCode, 429);
});

test('rateLimiter: redis failure fails open', async () => {
  const brokenRedis = { pipeline() { return { zremrangebyscore() { return this; }, zadd() { return this; }, zcard() { return this; }, expire() { return this; }, exec: async () => { throw new Error('down'); } }; } };
  const mw = slidingWindow({ keyPrefix: 't:', windowSec: 60, max: 1, keyFn: () => 'u', redis: brokenRedis });
  const res = mkRes();
  let nexted = false;
  await mw({ user: { sub: 'u' } }, res, () => { nexted = true; });
  assert.ok(nexted);
});

test('rateLimiter() factory returns a working middleware', () => {
  assert.equal(typeof rateLimiter(fakeRedisReturning(1)), 'function');
});

// ── inflight guard (fake redis) ─────────────────────────────────────────────
test('inflightGuard: first submission acquires the slot', async () => {
  const mw = inflightGuard({ set: async () => 'OK', del: async () => 1 });
  const req = { user: { sub: 'u' } };
  const res = mkRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.equal(typeof req.releaseInflightSlot, 'function');
});

test('inflightGuard: second concurrent submission → 409', async () => {
  const mw = inflightGuard({ set: async () => null, del: async () => 0 });
  const res = mkRes();
  await mw({ user: { sub: 'u' } }, res, () => assert.fail('should not next'));
  assert.equal(res.statusCode, 409);
});

// ── contest eligibility ─────────────────────────────────────────────────────
test('contestEligibility: ineligible submission is demoted, not rejected', async () => {
  const Contest = require('../../src/models/Contest');
  const orig = Contest.findById;
  Contest.findById = () => ({
    lean: async () => ({
      problemIds: [{ toString: () => 'other' }],
      startTime: new Date(Date.now() - 1000),
      endTime: new Date(Date.now() + 1000),
    }),
  });
  try {
    const req = { body: { contestId: 'c1', problemId: 'p1' } };
    const res = mkRes();
    let nexted = false;
    await assertContestEligible(req, res, () => { nexted = true; });
    assert.ok(nexted);
    assert.equal(req.body.contestId, null);
  } finally {
    Contest.findById = orig;
  }
});

test('contestEligibility: no contestId is a no-op', async () => {
  const req = { body: {} };
  const res = mkRes();
  let nexted = false;
  await assertContestEligible(req, res, () => { nexted = true; });
  assert.ok(nexted);
});

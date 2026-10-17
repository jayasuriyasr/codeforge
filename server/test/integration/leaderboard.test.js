'use strict';

// ── Contest leaderboard integration ────────────────────────────────────────
// Needs MongoDB + Redis (no Docker). Verifies the atomic incremental path and
// the Mongo rebuild agree, and that ICPC ordering is correct.
//
//   docker compose up -d   (mongo + redis are enough)
//   npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge_itest';

const { redis } = require('../../src/redis');
const Submission = require('../../src/models/Submission');
const User = require('../../src/models/User');
const {
  recordContestVerdict, getContestStandings, rebuildContest, _cKeys,
} = require('../../src/leaderboard');

let live = false;
const CID = new mongoose.Types.ObjectId().toString();
const P1 = new mongoose.Types.ObjectId().toString();
const P2 = new mongoose.Types.ObjectId().toString();
const START = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
let alice, bob;

before(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 1500 });
    await redis.ping();
    live = true;
  } catch { return; }
  alice = await User.create({ email: `a-${CID}@t.co`, passwordHash: 'x', displayName: 'Alice' });
  bob = await User.create({ email: `b-${CID}@t.co`, passwordHash: 'x', displayName: 'Bob' });
  const k = _cKeys(CID);
  await redis.del(k.z, k.solved, k.att, k.sc, k.pen);
});

after(async () => {
  if (!live) return;
  const k = _cKeys(CID);
  await redis.del(k.z, k.solved, k.att, k.sc, k.pen);
  await Submission.deleteMany({ contestId: CID });
  await User.deleteMany({ _id: { $in: [alice?._id, bob?._id].filter(Boolean) } });
  await mongoose.disconnect();
  await redis.quit();
});

const maybe = () => (live ? test : test.skip);

maybe()('incremental: rejects add penalty, first AC locks it, order is (solved desc, penalty asc)', async () => {
  const rec = (uid, pid, verdict, min) => recordContestVerdict({
    contestId: CID, userId: uid, problemId: pid, verdict,
    submittedAt: new Date(START.getTime() + min * 60000), contestStart: START,
  });

  // Alice: p1 AC at 10m clean; p2 WA at 12m then AC at 30m  → solved 2, penalty 10 + (30+20) = 60
  await rec(alice._id, P1, 'AC', 10);
  await rec(alice._id, P2, 'WA', 12);
  await rec(alice._id, P2, 'AC', 30);
  // Bob: p1 AC at 5m  → solved 1, penalty 5
  await rec(bob._id, P1, 'AC', 5);
  // a late extra AC for Alice p1 must be ignored
  await rec(alice._id, P1, 'AC', 40);

  const { rows } = await getContestStandings(CID);
  assert.equal(rows[0].name, 'Alice');
  assert.equal(rows[0].solved, 2);
  assert.equal(rows[0].penalty, 60);
  assert.equal(rows[1].name, 'Bob');
  assert.equal(rows[1].solved, 1);
  assert.equal(rows[1].penalty, 5);
});

maybe()('rebuild from Mongo reproduces the same standings', async () => {
  const mk = (uid, pid, verdict, min) => Submission.create({
    _id: `s-${uid}-${pid}-${min}`, userId: uid, problemId: pid, contestId: CID,
    code: 'x', language: 'python', status: 'DONE', verdict,
    createdAt: new Date(START.getTime() + min * 60000),
  });
  await mk(alice._id, P1, 'AC', 10);
  await mk(alice._id, P2, 'WA', 12);
  await mk(alice._id, P2, 'AC', 30);
  await mk(bob._id, P1, 'AC', 5);

  await rebuildContest(CID, START);
  const { rows } = await getContestStandings(CID);
  assert.equal(rows[0].name, 'Alice');
  assert.equal(rows[0].penalty, 60);
  assert.equal(rows[1].name, 'Bob');
  assert.equal(rows[1].penalty, 5);
});

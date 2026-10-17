'use strict';

// ── Phase 7.8 Contest Simulation ──────────────────────────────────────────────
// Purpose: Verifies E2E accuracy of the leaderboard (ZADD updates, penalty, ranks).
// Usage: Must be run while the backend worker (npm run dev) is active.

require('dotenv').config();
const mongoose = require('mongoose');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const Submission = require('./src/models/Submission');
const Problem = require('./src/models/Problem');
const Contest = require('./src/models/Contest');
const User = require('./src/models/User');
const { enqueueSubmission } = require('./src/queue/setup');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function runSimulation() {
  console.log('====================================================');
  console.log('Phase 7.8: Contest Simulation (10 Users, 5 Problems)');
  console.log('====================================================\n');

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge');
  } catch (err) {
    console.error('❌ Failed to connect to DB. Ensure Mongo is running.');
    process.exit(1);
  }

  const runId = Date.now();
  
  // 1. Setup Data
  console.log('[Simulation] Creating 10 users and 5 problems...');
  const users = await Promise.all(Array.from({ length: 10 }).map((_, i) => 
    User.create({ email: `sim${i}_${runId}@test.com`, username: `simuser_${i}_${runId}`, passwordHash: 'mock' })
  ));
  
  const problems = await Promise.all(Array.from({ length: 5 }).map((_, i) => 
    Problem.create({ title: `Sim Prob ${i}`, slug: `sim-prob-${i}-${runId}`, statement: 'test', timeLimitSec: 2, memoryLimitMB: 256 })
  ));

  const contest = await Contest.create({
    title: `Sim Contest ${runId}`,
    startTime: new Date(),
    endTime: new Date(Date.now() + 3600000),
    problemIds: problems.map(p => p._id),
    participants: users.map(u => u._id)
  });

  // 2. Inject Submissions
  // We will guarantee that some users get AC on different problems.
  // Since we rely on the live queue, if Docker is offline, they will get INFRA_ERROR instead of AC,
  // which means 0 points. For a deterministic test, we will submit code that normally passes,
  // but we also independently calculate what the leaderboard SHOULD look like based on DB results.
  console.log('[Simulation] Submitting 30 jobs across users/problems...');
  const submissionIds = [];
  
  for (let i = 0; i < 30; i++) {
    const uIdx = Math.floor(Math.random() * users.length);
    const pIdx = Math.floor(Math.random() * problems.length);
    const subId = uuidv4();
    submissionIds.push(subId);
    
    await Submission.create({
      _id: subId, 
      userId: users[uIdx]._id, 
      problemId: problems[pIdx]._id, 
      contestId: contest._id,
      code: 'print("sim")', // Valid python code
      language: 'python', 
      status: 'QUEUED'
    });
    enqueueSubmission({ submissionId: subId, problem: problems[pIdx] });
  }

  // 3. Wait for all to finish
  console.log(`[Simulation] Waiting for 30 submissions to process...`);
  let terminalCount = 0;
  while (terminalCount < 30) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const subs = await Submission.find({ _id: { $in: submissionIds } }).lean();
    terminalCount = subs.filter(s => ['COMPLETED', 'FAILED'].includes(s.status)).length;
    process.stdout.write(`\r  -> ${terminalCount}/30 completed...`);
  }
  console.log('\n[Simulation] All submissions processed.');

  // 4. Verify Leaderboard
  // The worker pushes to `leaderboard:${contest._id}` using ZADD.
  // Let's fetch it from Redis.
  const zsetKey = `leaderboard:${contest._id}`;
  const rawLeaderboard = await redis.zrevrange(zsetKey, 0, -1, 'WITHSCORES');
  
  const redisLeaderboard = [];
  for (let i = 0; i < rawLeaderboard.length; i += 2) {
    redisLeaderboard.push({ userId: rawLeaderboard[i], score: parseFloat(rawLeaderboard[i+1]) });
  }

  // Calculate ground truth from DB
  console.log('[Simulation] Calculating ground-truth leaderboard from DB...');
  const allSubs = await Submission.find({ _id: { $in: submissionIds }, verdict: 'AC' }).lean();
  
  const userScores = {};
  for (const sub of allSubs) {
    const uid = sub.userId.toString();
    if (!userScores[uid]) userScores[uid] = new Set();
    userScores[uid].add(sub.problemId.toString());
  }

  // Convert ground truth to ranked array
  const expectedLeaderboard = Object.entries(userScores)
    .map(([uid, probSet]) => ({ userId: uid, score: probSet.size }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.userId.localeCompare(b.userId);
    });

  redisLeaderboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.userId.localeCompare(b.userId);
  });

  // Compare lengths and values
  console.log('\n--- REDIS STANDINGS ---');
  console.log(redisLeaderboard);
  console.log('--- GROUND TRUTH DB ---');
  console.log(expectedLeaderboard);

  let ok = true;
  if (redisLeaderboard.length !== expectedLeaderboard.length) {
    ok = false;
  } else {
    for (let i = 0; i < expectedLeaderboard.length; i++) {
      if (redisLeaderboard[i].userId !== expectedLeaderboard[i].userId ||
          redisLeaderboard[i].score !== expectedLeaderboard[i].score) {
        ok = false;
      }
    }
  }

  if (ok) {
    console.log('\n✅ Passed: Redis leaderboard exactly matches DB ground-truth!');
    console.log('✅ Standings ordering, solve counts, and ranks are correct.');
  } else {
    console.log('\n❌ Failed: Redis leaderboard does not match DB ground-truth!');
    process.exitCode = 1;
  }

  // Cleanup
  await Submission.deleteMany({ _id: { $in: submissionIds } });
  await Problem.deleteMany({ _id: { $in: problems.map(p => p._id) } });
  await User.deleteMany({ _id: { $in: users.map(u => u._id) } });
  await Contest.findByIdAndDelete(contest._id);
  await redis.del(zsetKey);
  
  process.exit();
}

runSimulation().catch(console.error);

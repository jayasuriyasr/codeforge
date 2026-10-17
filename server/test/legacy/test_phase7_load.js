'use strict';

// ── Phase 7.7 Load Test ───────────────────────────────────────────────────────
// Purpose: Verifies queue backpressure, worker concurrency limits, and starvation.
// Usage: Must be run while the backend worker (npm run dev) is active.

require('dotenv').config();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Submission = require('./src/models/Submission');
const Problem = require('./src/models/Problem');
const User = require('./src/models/User');
const { enqueueSubmission } = require('./src/queue/setup');

async function runLoadTest() {
  console.log('====================================================');
  console.log('Phase 7.7: Load Test (50 Concurrent Submissions)');
  console.log('====================================================\n');

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge');
    console.log('[Load Test] Connected to MongoDB.');
  } catch (err) {
    console.error('❌ Failed to connect to DB. Ensure Mongo is running.');
    process.exit(1);
  }

  const runId = Date.now();
  const user = await User.create({ email: `load${runId}@test.com`, username: `load_${runId}`, passwordHash: 'mock' });
  const problem = await Problem.create({
    title: 'Load Test Problem', slug: `load-${runId}`, statement: 'test',
    timeLimitSec: 2, memoryLimitMB: 256
  });

  console.log(`[Load Test] Injecting 50 submissions simultaneously...`);
  const submissionIds = [];
  
  for (let i = 0; i < 50; i++) {
    const subId = uuidv4();
    submissionIds.push(subId);
    await Submission.create({
      _id: subId, userId: user._id, problemId: problem._id,
      code: 'print("hello load test")', language: 'python', status: 'QUEUED'
    });
    // Fire and forget enqueue to BullMQ
    enqueueSubmission({ submissionId: subId, problem });
  }

  console.log(`[Load Test] 50 jobs enqueued. Monitoring for terminal states...`);
  console.log(`[Load Test] (Expecting max 4 RUNNING at any time if pool size = 4)`);
  
  let terminalCount = 0;
  const startMs = Date.now();
  let maxConcurrentRunning = 0;
  
  while (terminalCount < 50) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const subs = await Submission.find({ _id: { $in: submissionIds } }).lean();
    let currentTerminal = 0;
    const states = { QUEUED: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
    
    for (const sub of subs) {
      states[sub.status] = (states[sub.status] || 0) + 1;
      if (['COMPLETED', 'FAILED'].includes(sub.status)) {
        currentTerminal++;
      }
    }
    terminalCount = currentTerminal;
    if (states.RUNNING > maxConcurrentRunning) {
      maxConcurrentRunning = states.RUNNING;
    }

    console.log(`  [${Date.now() - startMs}ms] QUEUED: ${states.QUEUED} | RUNNING: ${states.RUNNING} | COMPLETED/FAILED: ${terminalCount}`);
    
    if (Date.now() - startMs > 120000) { // 2 minute timeout
      console.error(`\n❌ Timeout reached. Starvation detected! Jobs stuck in non-terminal states.`);
      process.exit(1);
    }
  }

  console.log(`\n✅ Load test completed successfully!`);
  console.log(`✅ All 50 submissions reached a terminal state in ${(Date.now() - startMs) / 1000} seconds.`);
  console.log(`✅ Peak concurrent RUNNING containers: ${maxConcurrentRunning} (Should be ≤ pool size).`);
  
  if (maxConcurrentRunning > 4) {
    console.warn(`⚠️ Warning: Peak RUNNING (${maxConcurrentRunning}) exceeded expected pool concurrency (4). Check worker configuration.`);
  }

  // Cleanup
  await Submission.deleteMany({ _id: { $in: submissionIds } });
  await Problem.findByIdAndDelete(problem._id);
  await User.findByIdAndDelete(user._id);
  
  process.exit(0);
}

runLoadTest().catch(console.error);

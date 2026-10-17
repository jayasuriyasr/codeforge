'use strict';

const { Queue } = require('bullmq');
const { bullConnection } = require('../redis');
const { assertProblemLimits } = require('../utils/validation');

// Lazy — constructing a BullMQ Queue eagerly opens a Redis connection, which we
// don't want at require-time (tests, boot before Redis is up).
let _queue = null;
function queue() {
  if (!_queue) _queue = new Queue('submissions', { connection: bullConnection });
  return _queue;
}

/**
 * Enqueue a submission for the worker. The job payload is IDs ONLY — never the
 * problem document or its test cases (private contest cases must not sit in
 * Redis). The worker re-fetches from Mongo.
 *
 * @param {{ submissionId: string, problem?: object, systemTest?: boolean }} jobData
 *        `problem`    — used only for the defensive enqueue-time limit check.
 *        `systemTest` — re-judge on the FULL test set (post-contest pass).
 */
async function enqueueSubmission({ submissionId, problem, systemTest = false }) {
  if (problem) assertProblemLimits(problem);
  await queue().add(
    'submission',
    { submissionId, systemTest },
    { attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 }
  );
}

module.exports = { enqueueSubmission, queue };

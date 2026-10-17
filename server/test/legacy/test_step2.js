'use strict';

// ── Acceptance test for Step 2 ───────────────────────────────────────────────
// Runs without MongoDB (no network required).
// Tests: assertProblemLimits() + schema shape checks via Mongoose validation.

const mongoose = require('mongoose');
const { assertProblemLimits, ValidationError, LOCK_DURATION_MS } = require('./src/utils/validation');

let passed = 0;
let failed = 0;

function assert(label, fn) {
  try {
    fn();
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${label}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function assertThrows(label, fn, expectedMsg) {
  try {
    fn();
    console.error(`  ❌  ${label} — expected throw but none`);
    failed++;
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      console.error(`  ❌  ${label} — wrong error: "${err.message}"`);
      failed++;
    } else {
      console.log(`  ✅  ${label}`);
      passed++;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── assertProblemLimits ──────────────────────────────────────────');

assert('valid problem passes (timeLimitSec=2, memoryLimitMB=128)', () => {
  assertProblemLimits({ timeLimitSec: 2, memoryLimitMB: 128 });
});

assert('boundary values pass (timeLimitSec=10, memoryLimitMB=256)', () => {
  assertProblemLimits({ timeLimitSec: 10, memoryLimitMB: 256 });
});

assertThrows(
  'timeLimitSec=11 throws ValidationError',
  () => assertProblemLimits({ timeLimitSec: 11, memoryLimitMB: 128 }),
  'exceeds queue ceiling'
);

assertThrows(
  'memoryLimitMB=300 throws ValidationError',
  () => assertProblemLimits({ timeLimitSec: 2, memoryLimitMB: 300 }),
  'exceeds container ceiling'
);

assertThrows(
  'both over limit — timeLimitSec checked first',
  () => assertProblemLimits({ timeLimitSec: 11, memoryLimitMB: 300 }),
  'timeLimitSec'
);

assertThrows(
  'non-number timeLimitSec throws',
  () => assertProblemLimits({ timeLimitSec: '5', memoryLimitMB: 128 }),
  'must be a number'
);

assert('thrown error is instanceof ValidationError', () => {
  try {
    assertProblemLimits({ timeLimitSec: 11, memoryLimitMB: 128 });
  } catch (err) {
    if (!(err instanceof ValidationError)) throw new Error('not a ValidationError');
    if (err.status !== 400) throw new Error('status should be 400');
  }
});

assert('LOCK_DURATION_MS = 25000', () => {
  if (LOCK_DURATION_MS !== 25000) throw new Error(`Got ${LOCK_DURATION_MS}`);
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Schema shape checks (no DB connection) ───────────────────────');

const User       = require('./src/models/User');
const Problem    = require('./src/models/Problem');
const Contest    = require('./src/models/Contest');
const Submission = require('./src/models/Submission');

assert('User schema has email, passwordHash, role, timestamps', () => {
  const paths = User.schema.paths;
  if (!paths.email)        throw new Error('missing email');
  if (!paths.passwordHash) throw new Error('missing passwordHash');
  if (!paths.role)         throw new Error('missing role');
  if (!paths.createdAt)    throw new Error('missing timestamps');
});

assert('User role enum = [admin, contestant]', () => {
  const enumVals = User.schema.path('role').enumValues;
  if (!enumVals.includes('admin') || !enumVals.includes('contestant'))
    throw new Error(`Got ${enumVals}`);
});

assert('Problem schema has timeLimitSec, memoryLimitMB, checkerType, testCases', () => {
  const paths = Problem.schema.paths;
  if (!paths.timeLimitSec)  throw new Error('missing timeLimitSec');
  if (!paths.memoryLimitMB) throw new Error('missing memoryLimitMB');
  if (!paths.checkerType)   throw new Error('missing checkerType');
  if (!paths['testCases'])  throw new Error('missing testCases');
});

assert('Problem checkerType enum = [exact, float, special]', () => {
  const enumVals = Problem.schema.path('checkerType').enumValues;
  if (!enumVals.includes('exact') || !enumVals.includes('float') || !enumVals.includes('special'))
    throw new Error(`Got ${enumVals}`);
});

assert('Contest schema has startTime, endTime, problemIds, participants', () => {
  const paths = Contest.schema.paths;
  if (!paths.startTime)   throw new Error('missing startTime');
  if (!paths.endTime)     throw new Error('missing endTime');
  if (!paths.problemIds)  throw new Error('missing problemIds');
  if (!paths.participants) throw new Error('missing participants');
});

assert('Submission schema has all status enum values', () => {
  const enumVals = Submission.schema.path('status').enumValues;
  const required = ['QUEUED','COMPILING','RUNNING','AC','WA','TLE','MLE','RE','CE','INFRA_ERROR'];
  for (const v of required) {
    if (!enumVals.includes(v)) throw new Error(`missing status: ${v}`);
  }
});

assert('Submission contestId defaults to null (nullable)', () => {
  const defaultVal = Submission.schema.path('contestId').defaultValue;
  if (defaultVal !== null) throw new Error(`defaultValue = ${defaultVal}`);
});

assert('Submission code maxlength = 200000', () => {
  const maxlength = Submission.schema.path('code').options.maxlength;
  if (maxlength !== 200_000) throw new Error(`Got ${maxlength}`);
});

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
if (failed > 0) {
  process.exit(1);
}

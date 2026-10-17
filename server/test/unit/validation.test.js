'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const {
  assertProblemLimits,
  ValidationError,
  LOCK_DURATION_MS,
  MAX_ALLOWED_TIME_LIMIT_SEC,
  POOL_DEFAULT_MEMORY_MB,
} = require('../../src/utils/validation');

test('accepts a problem within limits', () => {
  assert.doesNotThrow(() => assertProblemLimits({ timeLimitSec: 2, memoryLimitMB: 256 }));
});

test('rejects timeLimitSec over the ceiling', () => {
  assert.throws(
    () => assertProblemLimits({ timeLimitSec: MAX_ALLOWED_TIME_LIMIT_SEC + 1, memoryLimitMB: 256 }),
    (e) => e instanceof ValidationError && /exceeds queue ceiling/.test(e.message)
  );
});

test('rejects memoryLimitMB over the ceiling', () => {
  assert.throws(
    () => assertProblemLimits({ timeLimitSec: 2, memoryLimitMB: POOL_DEFAULT_MEMORY_MB + 1 }),
    (e) => e instanceof ValidationError
  );
});

test('rejects non-numeric limits', () => {
  assert.throws(() => assertProblemLimits({ timeLimitSec: 'x', memoryLimitMB: 256 }), ValidationError);
  assert.throws(() => assertProblemLimits({ timeLimitSec: 2 }), ValidationError);
});

test('ValidationError carries HTTP 400', () => {
  const e = new ValidationError('nope');
  assert.equal(e.status, 400);
});

test('LOCK_DURATION_MS is a positive number', () => {
  assert.equal(typeof LOCK_DURATION_MS, 'number');
  assert.ok(LOCK_DURATION_MS > 0);
});

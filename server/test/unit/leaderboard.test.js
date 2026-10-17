'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { computeStandings, PENALTY_PER_REJECT } = require('../../src/leaderboard');

const START = new Date('2026-01-01T00:00:00Z');
const at = (min) => new Date(START.getTime() + min * 60000);

test('single AC with no prior rejects → penalty = minutes elapsed', () => {
  const { agg } = computeStandings([
    { userId: 'u1', problemId: 'p1', verdict: 'AC', createdAt: at(17) },
  ], START);
  assert.deepEqual(agg.get('u1'), { solved: 1, penalty: 17 });
});

test('rejects before the AC add 20 minutes each; CE is free', () => {
  const { agg } = computeStandings([
    { userId: 'u1', problemId: 'p1', verdict: 'CE', createdAt: at(2) },
    { userId: 'u1', problemId: 'p1', verdict: 'WA', createdAt: at(5) },
    { userId: 'u1', problemId: 'p1', verdict: 'TLE', createdAt: at(9) },
    { userId: 'u1', problemId: 'p1', verdict: 'AC', createdAt: at(12) },
  ], START);
  assert.deepEqual(agg.get('u1'), { solved: 1, penalty: 12 + 2 * PENALTY_PER_REJECT });
});

test('submissions after the AC do not change the score', () => {
  const { agg } = computeStandings([
    { userId: 'u1', problemId: 'p1', verdict: 'AC', createdAt: at(10) },
    { userId: 'u1', problemId: 'p1', verdict: 'WA', createdAt: at(20) },
  ], START);
  assert.deepEqual(agg.get('u1'), { solved: 1, penalty: 10 });
});

test('multiple problems aggregate solved + penalty', () => {
  const { agg, solvedKeys } = computeStandings([
    { userId: 'u1', problemId: 'p1', verdict: 'AC', createdAt: at(10) },
    { userId: 'u1', problemId: 'p2', verdict: 'WA', createdAt: at(15) },
    { userId: 'u1', problemId: 'p2', verdict: 'AC', createdAt: at(25) },
  ], START);
  assert.deepEqual(agg.get('u1'), { solved: 2, penalty: 10 + (25 + 20) });
  assert.deepEqual(solvedKeys.sort(), ['u1:p1', 'u1:p2']);
});

test('a user who never solves anything is absent', () => {
  const { agg } = computeStandings([
    { userId: 'u1', problemId: 'p1', verdict: 'WA', createdAt: at(5) },
    { userId: 'u1', problemId: 'p1', verdict: 'RE', createdAt: at(9) },
  ], START);
  assert.equal(agg.has('u1'), false);
});

test('submission before contest start → penalty floored at 0', () => {
  const { agg } = computeStandings([
    { userId: 'u1', problemId: 'p1', verdict: 'AC', createdAt: at(-5) },
  ], START);
  assert.equal(agg.get('u1').penalty, 0);
});

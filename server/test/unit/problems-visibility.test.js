'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { visibleTestCases } = require('../../src/routes/problems');

const cases = [
  { input: 'a', expectedOutput: '1', isSample: true },
  { input: 'b', expectedOutput: '2', isSample: false },
  { input: 'c', expectedOutput: '3', isSample: false },
];

test('practice mode: every test case is visible to anyone', () => {
  const p = { mode: 'practice', testCases: cases };
  assert.equal(visibleTestCases(p, undefined).length, 3);
  assert.equal(visibleTestCases(p, { role: 'contestant' }).length, 3);
});

test('contest mode: only sample test cases are visible to a contestant', () => {
  const p = { mode: 'contest', testCases: cases };
  const seen = visibleTestCases(p, { role: 'contestant' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].input, 'a');
});

test('contest mode: an admin sees every test case', () => {
  const p = { mode: 'contest', testCases: cases };
  assert.equal(visibleTestCases(p, { role: 'admin' }).length, 3);
});

test('contest mode: anonymous request sees only samples', () => {
  const p = { mode: 'contest', testCases: cases };
  assert.equal(visibleTestCases(p, undefined).length, 1);
});

test('handles a problem with no test cases', () => {
  assert.deepEqual(visibleTestCases({ mode: 'contest' }, undefined), []);
});

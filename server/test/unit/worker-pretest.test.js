'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { casesFor, problemHasPretests } = require('../../src/queue/worker');

const problem = {
  testCases: [
    { input: 'a', expectedOutput: '1', isSample: true },
    { input: 'b', expectedOutput: '2', pretest: true },
    { input: 'c', expectedOutput: '3' },
    { input: 'd', expectedOutput: '4' },
  ],
};

test('problemHasPretests detects the pretest flag', () => {
  assert.equal(problemHasPretests(problem), true);
  assert.equal(problemHasPretests({ testCases: [{ input: 'x', expectedOutput: 'y' }] }), false);
});

test('full pass runs every case and tags real indices', () => {
  const cases = casesFor(problem, { pretestOnly: false });
  assert.equal(cases.length, 4);
  assert.deepEqual(cases.map((c) => c._idx), [0, 1, 2, 3]);
});

test('pretest pass runs only samples + pretests, preserving real indices', () => {
  const cases = casesFor(problem, { pretestOnly: true });
  assert.equal(cases.length, 2);
  assert.deepEqual(cases.map((c) => c._idx), [0, 1]);   // the sample and the pretest
});

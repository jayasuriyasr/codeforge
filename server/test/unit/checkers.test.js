'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { defaultChecker, norm } = require('../../src/judge/checkers/exact');
const { floatChecker } = require('../../src/judge/checkers/float');
const { runChecks } = require('../../src/judge/testRunner');

// ── exact checker ───────────────────────────────────────────────────────────
test('exact: trailing whitespace and newlines are ignored', () => {
  assert.equal(defaultChecker('hello world \t \n\n', 'hello world'), true);
});

test('exact: interior differences are WA', () => {
  assert.equal(defaultChecker('hello  world', 'hello world'), false);
});

test('exact: CRLF is normalised to LF before compare', () => {
  assert.equal(defaultChecker('a\r\nb\r\n', 'a\nb'), true);
  assert.equal(norm('x\r\ny\r'), 'x\ny');
});

test('exact: empty vs whitespace-only both normalise to empty', () => {
  assert.equal(defaultChecker('   \n\n', ''), true);
});

// ── float checker ───────────────────────────────────────────────────────────
test('float: within epsilon is accepted', () => {
  assert.equal(floatChecker('1.0000001', '1.0').accepted, true);
});

test('float: beyond epsilon is rejected', () => {
  assert.equal(floatChecker('1.5', '1.0').accepted, false);
});

test('float: token count mismatch is rejected', () => {
  assert.equal(floatChecker('1 2 3', '1 2').accepted, false);
});

test('float: non-numeric tokens require exact match', () => {
  assert.equal(floatChecker('yes', 'yes').accepted, true);
  assert.equal(floatChecker('yes', 'no').accepted, false);
});

// ── testRunner.runChecks ────────────────────────────────────────────────────
const exactProblem = (cases) => ({ checkerType: 'exact', testCases: cases });

test('runChecks: all pass → AC', () => {
  const res = runChecks(exactProblem([
    { input: '1', expectedOutput: 'a' },
    { input: '2', expectedOutput: 'b' },
  ]), ['a', 'b']);
  assert.equal(res.verdict, 'AC');
  assert.equal(res.checkedCount, 2);
});

test('runChecks: short-circuits on first WA', () => {
  const res = runChecks(exactProblem([
    { input: '1', expectedOutput: 'a' },
    { input: '2', expectedOutput: 'b' },
    { input: '3', expectedOutput: 'c' },
  ]), ['a', 'WRONG', 'c']);
  assert.equal(res.verdict, 'WA');
  assert.equal(res.failedIndex, 1);
  assert.equal(res.checkedCount, 2);
});

test('runChecks: output/testcase count mismatch → INFRA_ERROR', () => {
  const res = runChecks(exactProblem([{ input: '1', expectedOutput: 'a' }]), ['a', 'b']);
  assert.equal(res.verdict, 'INFRA_ERROR');
});

test('runChecks: special checker type is a visible gap (INFRA_ERROR), not silent pass', () => {
  const res = runChecks(
    { checkerType: 'special', testCases: [{ input: '1', expectedOutput: 'a' }] },
    ['a']
  );
  assert.equal(res.verdict, 'INFRA_ERROR');
});

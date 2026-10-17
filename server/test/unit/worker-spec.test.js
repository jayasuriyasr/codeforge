'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { buildSpec, shapeFailed } = require('../../src/queue/worker');

const problem = (over = {}) => ({
  timeLimitSec: 2,
  memoryLimitMB: 128,
  mode: 'practice',
  testCases: [
    { input: '1 2', expectedOutput: '3', isSample: true },
    { input: '4 5', expectedOutput: '9', isSample: false },
  ],
  ...over,
});

test('buildSpec: C++ submission', () => {
  const spec = buildSpec(
    { language: 'cpp', code: 'int main(){}' },
    problem(),
    problem().testCases
  );
  assert.equal(spec.source_filename, 'solution.cpp');
  assert.match(spec.compile_cmd, /g\+\+/);
  assert.equal(spec.run_cmd, '/workspace/a.out');
  assert.equal(spec.time_limit_ms, 2000);
  assert.equal(spec.memory_limit_mb, 128);
  assert.equal(spec.cases.length, 2);
  assert.equal(Buffer.from(spec.cases[0].input_b64, 'base64').toString(), '1 2');
  assert.equal(Buffer.from(spec.source_b64, 'base64').toString(), 'int main(){}');
});

test('buildSpec: Python has no compile step', () => {
  const spec = buildSpec({ language: 'python', code: 'print(1)' }, problem(), problem().testCases);
  assert.equal(spec.compile_cmd, null);
  assert.match(spec.run_cmd, /python3/);
  assert.equal(spec.source_filename, 'solution.py');
});

test('buildSpec: Java derives the entry class from the source', () => {
  const code = 'public class Main { public static void main(String[] a){} }';
  const spec = buildSpec({ language: 'java', code }, problem(), problem().testCases);
  assert.equal(spec.source_filename, 'Main.java');
  assert.match(spec.compile_cmd, /javac .*Main\.java/);
  assert.match(spec.run_cmd, /java .* Main$/);
});

test('shapeFailed: practice reveals the full failing case', () => {
  const failed = { index: 1, input: '4 5', expectedOutput: '9', actualOutput: '10' };
  const shaped = shapeFailed(failed, problem());   // practice mode
  assert.equal(shaped.input, '4 5');
  assert.equal(shaped.actualOutput, '10');
});

test('shapeFailed: contest reveals a sample case', () => {
  const failed = { index: 0, input: '1 2', expectedOutput: '3', actualOutput: '4' };
  const shaped = shapeFailed(failed, problem({ mode: 'contest' }));
  assert.equal(shaped.input, '1 2');
});

test('shapeFailed: contest hides a PRIVATE case entirely', () => {
  const failed = { index: 1, input: '4 5', expectedOutput: '9', actualOutput: '10' };
  const shaped = shapeFailed(failed, problem({ mode: 'contest' }));
  assert.deepEqual(shaped, {});   // nothing revealed
});

test('shapeFailed: null in, null out', () => {
  assert.equal(shapeFailed(null, problem()), null);
});

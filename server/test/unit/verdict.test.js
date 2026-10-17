'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { assembleVerdict, JudgeInfraError } = require('../../src/judge/verdict');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

const problem = (cases, checkerType = 'exact', mode = 'practice') => ({
  checkerType, mode,
  testCases: cases.map(([input, expectedOutput], i) => ({ input, expectedOutput, isSample: i === 0 })),
});

const okCase = (index, stdout, extra = {}) => ({
  index, status: 'OK', wall_ms: 10, mem_mb: 4, stdout_b64: b64(stdout), stderr_b64: '', ...extra,
});

test('compile failure → CE with the compiler stderr', () => {
  const r = assembleVerdict({ ok: false, ms: 120, stderr: 'error: expected ;' }, null, problem([['a', 'b']]));
  assert.equal(r.verdict, 'CE');
  assert.match(r.compileError, /expected ;/);
  assert.deepEqual(r.testResults, []);
});

test('all cases pass the checker → AC, aggregates max time/mem', () => {
  const p = problem([['1', 'x'], ['2', 'y']]);
  const run = { cases: [okCase(0, 'x'), { ...okCase(1, 'y'), wall_ms: 40, mem_mb: 12 }] };
  const r = assembleVerdict({ ok: true, ms: 5 }, run, p);
  assert.equal(r.verdict, 'AC');
  assert.equal(r.runtimeMs, 40);
  assert.equal(r.memoryMB, 12);
  assert.equal(r.testResults.length, 2);
  assert.equal(r.failedTestCase, null);
});

test('checker rejects case 2 → WA, short-circuits, records the failing case', () => {
  const p = problem([['1', 'x'], ['2', 'y']]);
  const run = { cases: [okCase(0, 'x'), okCase(1, 'WRONG')] };
  const r = assembleVerdict({ ok: true }, run, p);
  assert.equal(r.verdict, 'WA');
  assert.equal(r.failedTestCase.index, 1);
  assert.equal(r.failedTestCase.expectedOutput, 'y');
  assert.equal(r.failedTestCase.actualOutput, 'WRONG');
  assert.equal(r.testResults.at(-1).verdict, 'WA');
});

test('supervisor TLE on a case → TLE verdict', () => {
  const p = problem([['1', 'x'], ['2', 'y']]);
  const run = { cases: [okCase(0, 'x'), { index: 1, status: 'TLE', wall_ms: 2100, mem_mb: 5, stdout_b64: '', stderr_b64: '' }] };
  const r = assembleVerdict({ ok: true }, run, p);
  assert.equal(r.verdict, 'TLE');
  assert.equal(r.failedTestCase.index, 1);
});

test('supervisor MLE on a case → MLE verdict', () => {
  const run = { cases: [{ index: 0, status: 'MLE', wall_ms: 300, mem_mb: 300, oom: true, stdout_b64: '', stderr_b64: '' }] };
  const r = assembleVerdict({ ok: true }, run, problem([['1', 'x']]));
  assert.equal(r.verdict, 'MLE');
});

test('supervisor RE / OLE → RE verdict', () => {
  assert.equal(assembleVerdict({ ok: true }, { cases: [{ index: 0, status: 'RE', wall_ms: 5, mem_mb: 2, stdout_b64: '', stderr_b64: b64('boom') }] }, problem([['1', 'x']])).verdict, 'RE');
  assert.equal(assembleVerdict({ ok: true }, { cases: [{ index: 0, status: 'OLE', wall_ms: 5, mem_mb: 2, stdout_b64: '', stderr_b64: '' }] }, problem([['1', 'x']])).verdict, 'RE');
});

test('AC claimed but fewer cases executed than exist → JudgeInfraError', () => {
  const p = problem([['1', 'x'], ['2', 'y'], ['3', 'z']]);
  const run = { cases: [okCase(0, 'x'), okCase(1, 'y')] }; // case 2 never ran
  assert.throws(() => assembleVerdict({ ok: true }, run, p), JudgeInfraError);
});

test('unknown checkerType → JudgeInfraError (never a silent AC)', () => {
  const p = problem([['1', 'x']], 'weird-checker');
  assert.throws(() => assembleVerdict({ ok: true }, { cases: [okCase(0, 'x')] }, p), JudgeInfraError);
});

test('float checker verdicts flow through', () => {
  const p = problem([['1', '2.00000']], 'float');
  assert.equal(assembleVerdict({ ok: true }, { cases: [okCase(0, '2.0000001')] }, p).verdict, 'AC');
  assert.equal(assembleVerdict({ ok: true }, { cases: [okCase(0, '2.5')] }, p).verdict, 'WA');
});

test('special checker: opts.checkCase overrides the built-in checker', () => {
  const p = problem([['1', 'x'], ['2', 'y']], 'special');
  const run = { cases: [okCase(0, 'anything'), okCase(1, 'whatever')] };
  const results = new Map([[0, { accepted: true }], [1, { accepted: false, message: 'nope' }]]);
  const r = assembleVerdict({ ok: true }, run, p, { checkCase: (i) => results.get(i) });
  assert.equal(r.verdict, 'WA');
  assert.equal(r.failedTestCase.index, 1);
});

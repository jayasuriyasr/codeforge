import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePractice } from '../src/judge/index.js';

// judgePractice orchestration, with a fake runner. Mirrors the server pipeline:
// run each case → OK means check output (AC/WA), else the runner's status is the
// verdict → stop at the first non-AC → aggregate max time/mem.

const problem = (cases, over = {}) => ({
  checkerType: 'exact', timeLimitSec: 2, memoryLimitMB: 64,
  testCases: cases.map(([input, expectedOutput]) => ({ input, expectedOutput })),
  ...over,
});

// runner that returns a scripted result per call
const scriptRunner = (script) => {
  let i = 0;
  return async () => script[i++];
};

test('all cases OK + correct output → AC, aggregates max wall/mem', async () => {
  const r = await judgePractice({
    language: 'javascript', code: '',
    problem: problem([['1', 'a'], ['2', 'b']]),
    runner: scriptRunner([
      { status: 'OK', wallMs: 10, memMb: 4, stdout: 'a' },
      { status: 'OK', wallMs: 40, memMb: 20, stdout: 'b' },
    ]),
  });
  assert.equal(r.verdict, 'AC');
  assert.equal(r.runtimeMs, 40);
  assert.equal(r.memoryMB, 20);
  assert.equal(r.cases.length, 2);
});

test('wrong output on case 2 → WA, short-circuits', async () => {
  const r = await judgePractice({
    language: 'javascript', code: '',
    problem: problem([['1', 'a'], ['2', 'b'], ['3', 'c']]),
    runner: scriptRunner([
      { status: 'OK', wallMs: 5, memMb: 3, stdout: 'a' },
      { status: 'OK', wallMs: 5, memMb: 3, stdout: 'WRONG' },
      { status: 'OK', wallMs: 5, memMb: 3, stdout: 'c' },
    ]),
  });
  assert.equal(r.verdict, 'WA');
  assert.equal(r.failedIndex, 1);
  assert.equal(r.cases.length, 2);
  assert.equal(r.failedTestCase.expectedOutput, 'b');
  assert.equal(r.failedTestCase.actualOutput, 'WRONG');
});

test('runner reports TLE → TLE verdict on that case', async () => {
  const r = await judgePractice({
    language: 'python', code: '',
    problem: problem([['1', 'a'], ['2', 'b']]),
    runner: scriptRunner([
      { status: 'OK', wallMs: 10, memMb: 4, stdout: 'a' },
      { status: 'TLE', wallMs: 2400, memMb: 4, stdout: '' },
    ]),
  });
  assert.equal(r.verdict, 'TLE');
  assert.equal(r.failedIndex, 1);
});

test('runner reports MLE → MLE verdict (client-side memory verdict)', async () => {
  const r = await judgePractice({
    language: 'python', code: '',
    problem: problem([['1', 'a']]),
    runner: scriptRunner([{ status: 'MLE', wallMs: 300, memMb: 210, stdout: '' }]),
  });
  assert.equal(r.verdict, 'MLE');
  assert.equal(r.cases[0].memMb, 210);
});

test('runner throws → RE, not a crash', async () => {
  const r = await judgePractice({
    language: 'javascript', code: '',
    problem: problem([['1', 'a']]),
    runner: async () => { throw new Error('boom'); },
  });
  assert.equal(r.verdict, 'RE');
});

test('float checker flows through the client judge', async () => {
  const r = await judgePractice({
    language: 'python', code: '',
    problem: problem([['1', '2.00000']], { checkerType: 'float' }),
    runner: scriptRunner([{ status: 'OK', wallMs: 5, memMb: 3, stdout: '2.0000001' }]),
  });
  assert.equal(r.verdict, 'AC');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyForm, slugify, parseTags, validateForm, toPayload, formFromProblem } from '../src/lib/problemForm.js';
import { toProblem } from '../src/lib/problemShape.js';

const valid = () => ({
  ...emptyForm(),
  title: 'Sum of Two',
  slug: 'sum-of-two',
  statement: 'Print a + b.',
  testCases: [
    { input: '1 2', expectedOutput: '3', sample: true },
    { input: '5 5', expectedOutput: '10', sample: false },
  ],
});

test('slugify makes URL-safe slugs', () => {
  assert.equal(slugify('Two Sum II!'), 'two-sum-ii');
  assert.equal(slugify('  Café — Déjà vu  '), 'cafe-deja-vu');
  assert.equal(slugify('***'), '');
});

test('parseTags trims, lowercases and de-duplicates', () => {
  assert.deepEqual(parseTags('Array, hash map ,array,, DP'), ['array', 'hash map', 'dp']);
});

test('a complete form is valid', () => {
  assert.deepEqual(validateForm(valid()), []);
});

test('validation catches each missing piece', () => {
  const f = valid();
  assert.match(validateForm({ ...f, title: ' ' }).join(), /title/);
  assert.match(validateForm({ ...f, slug: 'Bad Slug' }).join(), /slug/);
  assert.match(validateForm({ ...f, statement: '' }).join(), /description/);
  assert.match(validateForm({ ...f, timeLimitSec: 30 }).join(), /Time limit/);
  assert.match(validateForm({ ...f, memoryLimitMB: 8 }).join(), /Memory limit/);
  assert.match(validateForm({ ...f, testCases: [] }).join(), /at least one test case/);
  assert.match(validateForm({ ...f, testCases: f.testCases.map((c) => ({ ...c, sample: false })) }).join(), /sample/);
  assert.match(validateForm({ ...f, testCases: [{ input: '1', expectedOutput: ' ', sample: true }] }).join(), /expected output/);
});

test('toPayload produces what save_problem() expects', () => {
  const p = toPayload({ ...valid(), tags: 'Math, math', statement: 'a\r\nb  ', published: true });
  assert.deepEqual(p.tags, ['math']);
  assert.equal(p.statement, 'a\nb');
  assert.equal(p.time_limit_sec, 2);
  assert.equal(p.published, true);
  assert.deepEqual(p.test_cases[0], { input: '1 2', expected_output: '3', is_sample: true });
});

test('database rows map to the judge shape and back into the form', () => {
  const row = {
    id: 7, slug: 'sum-of-two', title: 'Sum of Two', difficulty: 'easy', tags: ['math'], statement: 's',
    time_limit_sec: '2.0', memory_limit_mb: 128, checker_type: 'exact', published: false, created_by: 'u1',
    test_cases: [
      { position: 1, input: '5 5', expected_output: '10', is_sample: false },
      { position: 0, input: '1 2', expected_output: '3', is_sample: true },
    ],
  };
  const p = toProblem(row);
  assert.equal(p.timeLimitSec, 2);
  assert.equal(p.caseCount, 2);
  assert.deepEqual(p.testCases[0], { input: '1 2', expectedOutput: '3', sample: true }); // sorted by position
  assert.deepEqual(formFromProblem(p).testCases.map((c) => c.input), ['1 2', '5 5']);

  const listRow = { ...row, test_cases: [{ count: 9 }] };
  assert.equal(toProblem(listRow).caseCount, 9);
  assert.equal(toProblem(listRow).testCases, undefined);
});

test('the Solve page shape: samples now, full test set later', () => {
  const row = {
    id: 9, slug: 's', title: 'S', difficulty: 'easy', tags: [], statement: 's',
    time_limit_sec: 2, memory_limit_mb: 128, checker_type: 'exact', published: true, created_by: null,
    updated_at: '2026-10-21T00:00:00Z',
    samples: [{ position: 3, input: 'b', expected_output: 'B', is_sample: true }, { position: 0, input: 'a', expected_output: 'A', is_sample: true }],
    test_cases: [{ count: 37 }],
  };
  const p = toProblem(row);
  assert.equal(p.caseCount, 37);                       // the count shown on the page is the full set
  assert.equal(p.allCasesLoaded, false);                // judge must download the rest first
  assert.deepEqual(p.testCases.map((c) => c.input), ['a', 'b']);
  assert.equal(toProblem({ ...row, samples: undefined, test_cases: [{ position: 0, input: 'x', expected_output: 'y', is_sample: false }] }).allCasesLoaded, true);
});

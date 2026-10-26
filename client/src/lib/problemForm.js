// lib/problemForm.js
// ── The admin "create / edit problem" form: defaults, validation, payload ──
//
// Pure functions (unit-tested in test/problemForm.test.js). The database
// re-checks the same limits, so this is for friendly messages, not security.

export const LIMITS = {
  title: 120,
  statement: 20000,
  maxCases: 1000,
  caseChars: 1000000,
  timeSec: [0.5, 10],
  memoryMB: [16, 512],
};

export function emptyTestCase(sample = false) {
  return { input: '', expectedOutput: '', sample };
}

export function emptyForm() {
  return {
    id: null,
    title: '',
    slug: '',
    difficulty: 'easy',
    tags: '',
    statement: '',
    timeLimitSec: 2,
    memoryLimitMB: 128,
    checkerType: 'exact',
    published: false,
    testCases: [emptyTestCase(true), emptyTestCase(false)],
  };
}

/** "Two Sum II!" → "two-sum-ii" */
export function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export function parseTags(text) {
  return [...new Set(String(text).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

/** Problem (from lib/problems.js toProblem) → form state. */
export function formFromProblem(p) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    difficulty: p.difficulty,
    tags: (p.tags || []).join(', '),
    statement: p.statement,
    timeLimitSec: p.timeLimitSec,
    memoryLimitMB: p.memoryLimitMB,
    checkerType: p.checkerType || 'exact',
    published: p.published,
    testCases: p.testCases.map((c) => ({ input: c.input, expectedOutput: c.expectedOutput, sample: c.sample })),
  };
}

/** @returns {string[]} human-readable problems with the form; empty = valid */
export function validateForm(f) {
  const errs = [];
  if (!f.title.trim()) errs.push('Give the problem a title.');
  if (f.title.length > LIMITS.title) errs.push(`Title must be at most ${LIMITS.title} characters.`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug)) errs.push('URL slug can only use lowercase letters, numbers and single dashes (e.g. two-sum).');
  if (!['easy', 'medium', 'hard'].includes(f.difficulty)) errs.push('Pick a difficulty.');
  if (!f.statement.trim()) errs.push('Write the problem description.');
  if (f.statement.length > LIMITS.statement) errs.push(`Description must be at most ${LIMITS.statement} characters.`);

  const t = Number(f.timeLimitSec);
  if (!(t >= LIMITS.timeSec[0] && t <= LIMITS.timeSec[1])) errs.push(`Time limit must be between ${LIMITS.timeSec[0]} and ${LIMITS.timeSec[1]} seconds.`);
  const m = Number(f.memoryLimitMB);
  if (!(Number.isInteger(m) && m >= LIMITS.memoryMB[0] && m <= LIMITS.memoryMB[1])) errs.push(`Memory limit must be a whole number between ${LIMITS.memoryMB[0]} and ${LIMITS.memoryMB[1]} MB.`);

  const cases = f.testCases || [];
  if (cases.length === 0) errs.push('Add at least one test case.');
  if (cases.length > LIMITS.maxCases) errs.push(`At most ${LIMITS.maxCases} test cases.`);
  if (cases.length && !cases.some((c) => c.sample)) errs.push('Mark at least one test case as a sample, so solvers can see an example.');
  cases.forEach((c, i) => {
    if (!c.expectedOutput.trim()) errs.push(`Test case ${i + 1} needs an expected output.`);
    if (c.input.length > LIMITS.caseChars || c.expectedOutput.length > LIMITS.caseChars) errs.push(`Test case ${i + 1} is too large.`);
  });
  return errs;
}

/** Form state → the JSON that the save_problem() database function takes. */
export function toPayload(f) {
  return {
    id: f.id ?? null,
    slug: f.slug,
    title: f.title.trim(),
    difficulty: f.difficulty,
    tags: parseTags(f.tags),
    statement: f.statement.replace(/\r\n/g, '\n').trim(),
    time_limit_sec: Number(f.timeLimitSec),
    memory_limit_mb: Number(f.memoryLimitMB),
    checker_type: f.checkerType,
    published: !!f.published,
    test_cases: f.testCases.map((c) => ({
      input: c.input.replace(/\r\n/g, '\n'),
      expected_output: c.expectedOutput.replace(/\r\n/g, '\n'),
      is_sample: !!c.sample,
    })),
  };
}

// lib/problemShape.js
// ── Database row → the problem shape the judge and pages use ───────────────
// Kept free of the Supabase client so it can be unit-tested in plain Node.

export const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 };

const byPosition = (a, b) => a.position - b.position;
export const toTestCases = (rows) =>
  [...rows].sort(byPosition).map((c) => ({ input: c.input, expectedOutput: c.expected_output, sample: c.is_sample }));

/**
 * DB row → the shape the judge and pages use (same as the old static JSON).
 * A row can carry every test case (`test_cases(...)`), only a count
 * (`test_cases(count)`), or the samples plus a count (`samples:test_cases(...)`
 * + `test_cases(count)`) — the Solve page uses the last form and downloads the
 * full set only when the user clicks Judge.
 */
export function toProblem(row) {
  const counted = row.test_cases?.[0]?.count !== undefined;
  const cases = Array.isArray(row.test_cases) && !counted ? toTestCases(row.test_cases) : null;
  const samples = Array.isArray(row.samples) ? toTestCases(row.samples) : null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    tags: row.tags || [],
    statement: row.statement,
    timeLimitSec: Number(row.time_limit_sec),
    memoryLimitMB: row.memory_limit_mb,
    checkerType: row.checker_type || 'exact',
    published: row.published,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    caseCount: cases ? cases.length : (row.test_cases?.[0]?.count ?? 0),
    testCases: cases || samples || undefined,
    allCasesLoaded: Boolean(cases),
  };
}

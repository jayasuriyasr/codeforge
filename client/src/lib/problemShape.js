// lib/problemShape.js
// ── Database row → the problem shape the judge and pages use ───────────────
// Kept free of the Supabase client so it can be unit-tested in plain Node.

export const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 };

/** DB row → the shape the judge and pages use (same as the old static JSON). */
export function toProblem(row) {
  const cases = Array.isArray(row.test_cases) && row.test_cases[0]?.count === undefined
    ? [...row.test_cases].sort((a, b) => a.position - b.position)
    : null;
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
    testCases: cases
      ? cases.map((c) => ({ input: c.input, expectedOutput: c.expected_output, sample: c.is_sample }))
      : undefined,
  };
}

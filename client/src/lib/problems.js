// lib/problems.js
// ── Problems and test cases, from Supabase ─────────────────────────────────
//
// Everyone (guests included) can read published problems with their test
// cases — judging happens in the browser, so it needs them. Admins also see
// their own drafts, and can create / edit / publish / delete only problems
// they created. All of that is enforced by RLS (supabase/schema.sql); these
// functions are just the queries.

import { requireDb, unwrap } from './supabase.js';
import { toProblem, toTestCases, DIFFICULTY_ORDER } from './problemShape.js';

export { toProblem, DIFFICULTY_ORDER };

const LIST_COLUMNS =
  'id, slug, title, difficulty, tags, time_limit_sec, memory_limit_mb, published, created_by, created_at, updated_at, test_cases(count)';
const PROBLEM_COLUMNS =
  'id, slug, title, difficulty, tags, statement, time_limit_sec, memory_limit_mb, checker_type, published, created_by, updated_at';
const CASE_COLUMNS = 'position, input, expected_output, is_sample';
const FULL_COLUMNS = `${PROBLEM_COLUMNS}, test_cases(${CASE_COLUMNS})`;
// Opening a problem fetches only its samples (plus how many cases there are);
// big hidden cases can be megabytes, so they're downloaded on the first Judge.
const SOLVE_COLUMNS = `${PROBLEM_COLUMNS}, samples:test_cases(${CASE_COLUMNS}), test_cases(count)`;

const byDifficultyThenTitle = (a, b) =>
  (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.title.localeCompare(b.title);

/** Published problems for the catalogue (no test-case bodies, just counts). */
export async function loadIndex() {
  const rows = unwrap(await requireDb().from('problems').select(LIST_COLUMNS).eq('published', true));
  return rows.map(toProblem).sort(byDifficultyThenTitle);
}

/**
 * One problem by slug, with its SAMPLE test cases only (`allCasesLoaded` is
 * false); `loadAllTestCases` fetches the rest. Drafts resolve only for their author.
 */
export async function loadProblem(slug) {
  const row = unwrap(await requireDb().from('problems').select(SOLVE_COLUMNS)
    .eq('slug', slug).eq('samples.is_sample', true).maybeSingle());
  if (!row) throw new Error('problem not found');
  return toProblem(row);
}

// Full test sets, kept for the session. Keyed by updated_at too, so an admin's
// edit is picked up on the next page load.
const _allCases = new Map();

/** Every test case of `problem` (from loadProblem), downloaded once per session. */
export async function loadAllTestCases(problem) {
  if (problem.allCasesLoaded) return problem.testCases;
  const key = `${problem.id}@${problem.updatedAt}`;
  if (!_allCases.has(key)) {
    const p = requireDb().from('test_cases').select(CASE_COLUMNS).eq('problem_id', problem.id)
      .order('position').then((res) => toTestCases(unwrap(res)));
    _allCases.set(key, p);
    p.catch(() => _allCases.delete(key));
  }
  return _allCases.get(key);
}

export async function loadProblemById(id) {
  const row = unwrap(await requireDb().from('problems').select(FULL_COLUMNS).eq('id', id).maybeSingle());
  if (!row) throw new Error('problem not found');
  return toProblem(row);
}

/** Every problem this admin created — drafts and published. */
export async function loadMyProblems(userId) {
  const rows = unwrap(await requireDb().from('problems').select(LIST_COLUMNS)
    .eq('created_by', userId).order('updated_at', { ascending: false }));
  return rows.map(toProblem);
}

/** Create (no id) or update a problem and replace its test cases, atomically. */
export async function saveProblem(payload) {
  return unwrap(await requireDb().rpc('save_problem', { p: payload }));
}

export async function setPublished(id, published) {
  const rows = unwrap(await requireDb().from('problems')
    .update({ published, updated_at: new Date().toISOString() }).eq('id', id).select('id'));
  if (!rows.length) throw new Error('You can only publish problems you created.');
}

export async function deleteProblem(id) {
  const rows = unwrap(await requireDb().from('problems').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error('You can only delete problems you created.');
}

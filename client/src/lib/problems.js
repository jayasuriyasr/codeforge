// lib/problems.js
// ── Problems and test cases, from Supabase ─────────────────────────────────
//
// Everyone (guests included) can read published problems with their test
// cases — judging happens in the browser, so it needs them. Admins also see
// their own drafts, and can create / edit / publish / delete only problems
// they created. All of that is enforced by RLS (supabase/schema.sql); these
// functions are just the queries.

import { requireDb, unwrap } from './supabase.js';
import { toProblem, DIFFICULTY_ORDER } from './problemShape.js';

export { toProblem, DIFFICULTY_ORDER };

const LIST_COLUMNS =
  'id, slug, title, difficulty, tags, time_limit_sec, memory_limit_mb, published, created_by, created_at, updated_at, test_cases(count)';
const FULL_COLUMNS =
  'id, slug, title, difficulty, tags, statement, time_limit_sec, memory_limit_mb, checker_type, published, created_by, '
  + 'test_cases(position, input, expected_output, is_sample)';

const byDifficultyThenTitle = (a, b) =>
  (DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]) || a.title.localeCompare(b.title);

/** Published problems for the catalogue (no test-case bodies, just counts). */
export async function loadIndex() {
  const rows = unwrap(await requireDb().from('problems').select(LIST_COLUMNS).eq('published', true));
  return rows.map(toProblem).sort(byDifficultyThenTitle);
}

/** One problem with every test case, by slug. Drafts resolve only for their author. */
export async function loadProblem(slug) {
  const row = unwrap(await requireDb().from('problems').select(FULL_COLUMNS).eq('slug', slug).maybeSingle());
  if (!row) throw new Error('problem not found');
  return toProblem(row);
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

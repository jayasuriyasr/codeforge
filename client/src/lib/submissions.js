// lib/submissions.js
// ── Submissions and progress, for signed-in users ──────────────────────────
//
// The browser judges the code, then stores the result here. RLS lets a user
// insert and read only their own rows (supabase/schema.sql).

import { requireDb, unwrap } from './supabase.js';

const STORABLE = new Set(['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE']);
export const MAX_CODE_CHARS = 65536;

/** Store a judged submission. Returns false when there's nothing storable. */
export async function saveSubmission({ problemId, language, code, result, totalCases }) {
  if (!STORABLE.has(result?.verdict)) return false;
  if (code.length > MAX_CODE_CHARS) throw new Error(`Code is over ${MAX_CODE_CHARS} characters, so it wasn’t saved.`);
  const passed = (result.cases || []).filter((c) => c.status === 'AC').length;
  unwrap(await requireDb().from('submissions').insert({
    problem_id: problemId,
    language,
    code,
    verdict: result.verdict,
    passed,
    total: totalCases,
    runtime_ms: result.verdict === 'CE' ? null : Math.round(result.runtimeMs || 0),
    memory_mb: result.memoryMB ? Number(result.memoryMB.toFixed(1)) : null,
  }));
  return true;
}

/** Newest first. Pass problemId to filter to one problem. */
export async function loadMySubmissions({ problemId, limit = 20, withCode = false } = {}) {
  let q = requireDb().from('submissions')
    .select(`id, problem_id, language, verdict, passed, total, runtime_ms, memory_mb, created_at, problems(slug, title)${withCode ? ', code' : ''}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (problemId) q = q.eq('problem_id', problemId);
  return unwrap(await q);
}

/** { total, solved, submissions, accepted, by_difficulty: [{difficulty, total, solved}] } */
export async function loadStats() {
  return unwrap(await requireDb().rpc('my_stats'));
}

/** Ids of problems the signed-in user has an Accepted submission for. */
export async function loadSolvedIds() {
  const rows = unwrap(await requireDb().from('submissions').select('problem_id').eq('verdict', 'AC'));
  return new Set(rows.map((r) => r.problem_id));
}

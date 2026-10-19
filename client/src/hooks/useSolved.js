import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './useAuth.js';
import { useProfile } from './useProfile.js';
import { loadSolvedIds } from '../lib/submissions.js';

// ── "Have I solved this?" ───────────────────────────────────────────────────
// Signed in: from the user's Accepted submissions in the database.
// Guest: from the local profile in this browser (lib/profile.js), as before.

let solvedIds = null;          // Set<problemId> for `forUser`, or null
let forUser = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => solvedIds;

export function refreshSolved(userId) {
  forUser = userId;
  if (!userId) { solvedIds = null; emit(); return; }
  loadSolvedIds()
    .then((ids) => { if (forUser === userId) { solvedIds = ids; emit(); } })
    .catch(() => {});
}

export function markSolvedId(problemId) {
  solvedIds = new Set(solvedIds || []).add(problemId);
  emit();
}

/** @returns {(problem: { id, slug }) => boolean} */
export function useSolved() {
  const { user } = useAuth();
  const local = useProfile();
  const ids = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if ((user?.id ?? null) !== forUser) refreshSolved(user?.id ?? null);
  }, [user?.id]);

  if (user) return (p) => !!ids?.has(p.id);
  const slugs = new Set(local.solved);
  return (p) => slugs.has(p.slug);
}

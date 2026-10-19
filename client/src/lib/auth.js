// lib/auth.js
// ── Who is signed in ───────────────────────────────────────────────────────
//
// Email + password accounts via Supabase Auth. There is one login for
// everybody; the `role` on the account's profile row ('user' | 'admin')
// decides what the UI offers. The database enforces the same rules (RLS), so
// hiding a button is never the only protection.

import { supabase, unwrap, requireDb } from './supabase.js';

// `ready` flips to true once the stored session (if any) has been restored.
let state = { ready: !supabase, user: null, profile: null };
const listeners = new Set();

function set(next) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

export function subscribeAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAuth() {
  return state;
}

async function loadProfile(user) {
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('id, username, role').eq('id', user.id).maybeSingle();
  return data ?? { id: user.id, username: user.email, role: 'user' };
}

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    if (user?.id === state.user?.id && state.ready) { set({ user }); return; } // token refresh
    // supabase-js deadlocks if another call is awaited inside this callback.
    setTimeout(async () => {
      const profile = await loadProfile(user).catch(() => null);
      set({ ready: true, user, profile });
    }, 0);
  });
}

export async function signIn(email, password) {
  unwrap(await requireDb().auth.signInWithPassword({ email, password }));
}

/** @returns {{ needsConfirmation: boolean }} */
export async function signUp(email, password, username) {
  const data = unwrap(await requireDb().auth.signUp({ email, password, options: { data: { username } } }));
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  await requireDb().auth.signOut();
}

export async function renameMe(username) {
  const { user } = state;
  unwrap(await requireDb().from('profiles').update({ username }).eq('id', user.id));
  set({ profile: { ...state.profile, username } });
}

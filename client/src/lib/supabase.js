// lib/supabase.js
// ── The one Supabase client ────────────────────────────────────────────────
//
// There is no backend of our own: the browser talks to Supabase directly. The
// project URL and anon key are public by design (vite.config.js injects them
// at build time); what each visitor may read or write is enforced by Row Level
// Security in the database — see supabase/schema.sql.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isHttpUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

// A missing or malformed setting must not take the whole app down — the
// catalogue then shows "database isn't configured" instead.
export const dbConfigured = Boolean(isHttpUrl(url) && key && !/^\[/.test(key));

export const supabase = dbConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const MESSAGES = {
  23505: 'That slug is already used by another problem — pick a different one.',
  23514: 'Some field is out of range (check the limits and lengths).',
  42501: 'You don’t have permission to do that.',
};

/** Turn a Supabase `{ data, error }` result into data, or a readable Error. */
export function unwrap({ data, error }) {
  if (error) {
    const msg = error.code === '42501' && error.message && !/row-level security|permission denied/i.test(error.message)
      ? error.message                      // our own messages from save_problem()
      : MESSAGES[error.code] || error.message || 'Something went wrong.';
    throw new Error(msg);
  }
  return data;
}

export function requireDb() {
  if (!supabase) throw new Error('The database isn’t configured for this build.');
  return supabase;
}

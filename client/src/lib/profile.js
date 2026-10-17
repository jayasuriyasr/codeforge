// lib/profile.js
// ── Local profile — the only "account" this app has ─────────────────────────
// Everything lives in localStorage. No server, no sign-in, nothing to leak.
// A "profile" is just a display name plus the set of problems solved locally,
// per-problem code drafts, and settings.
//
// Shape (JSON in localStorage under CF_KEY):
//   { name, solved: string[], drafts: { [slug]: { [lang]: code } }, lang, createdAt }

const CF_KEY = 'codeforge.profile.v1';

const EMPTY = () => ({ name: '', solved: [], drafts: {}, lang: 'python', createdAt: Date.now() });

// Cached snapshot — `getProfile()` must return a STABLE reference between
// changes, or useSyncExternalStore re-renders forever (React error #185).
let _snap = null;

function load() {
  try {
    const raw = localStorage.getItem(CF_KEY);
    if (!raw) return EMPTY();
    const p = JSON.parse(raw);
    return { ...EMPTY(), ...p, solved: Array.isArray(p.solved) ? p.solved : [], drafts: p.drafts || {} };
  } catch {
    return EMPTY();
  }
}

function read() {
  if (!_snap) _snap = load();
  return _snap;
}

/** Apply `mut` to a mutable clone, persist, and publish a new snapshot. */
function update(mut) {
  const next = structuredClone(read());
  mut(next);
  _snap = next;
  try { localStorage.setItem(CF_KEY, JSON.stringify(next)); } catch { /* storage disabled */ }
  emit();
}

// ── tiny pub/sub so React can re-render on change ───────────────────────────
const listeners = new Set();
function emit() { for (const fn of listeners) fn(); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === CF_KEY) { _snap = null; emit(); } });
}

// ── public API ─────────────────────────────────────────────────────────────
export function getProfile() { return read(); }
export function hasName() { return !!read().name; }

export function setName(name) {
  update((p) => { p.name = String(name || '').trim().slice(0, 40); });
}

export function isSolved(slug) { return read().solved.includes(slug); }
export function solvedSet() { return new Set(read().solved); }

export function markSolved(slug) {
  if (read().solved.includes(slug)) return;
  update((p) => { p.solved.push(slug); });
}

export function getDraft(slug, lang) { return read().drafts?.[slug]?.[lang] ?? null; }

export function saveDraft(slug, lang, code) {
  update((p) => { (p.drafts[slug] = p.drafts[slug] || {})[lang] = code; });
}

export function getLang() { return read().lang; }
export function setLang(lang) { update((p) => { p.lang = lang; }); }

export function resetProfile() {
  try { localStorage.removeItem(CF_KEY); } catch { /* ignore */ }
  _snap = EMPTY();
  emit();
}

export function exportProfile() { return JSON.stringify(read(), null, 2); }

export function importProfile(json) {
  try {
    const p = JSON.parse(json);
    _snap = { ...EMPTY(), ...p, solved: Array.isArray(p.solved) ? p.solved : [], drafts: p.drafts || {} };
    try { localStorage.setItem(CF_KEY, JSON.stringify(_snap)); } catch { /* ignore */ }
    emit();
    return true;
  } catch {
    return false;
  }
}

// lib/problems.js
// ── Problem catalogue — static JSON, no database ───────────────────────────
// `npm run build:problems` turns content/problems/*.json into:
//   public/problems/index.json           — [{ slug, title, difficulty, tags, timeLimitSec, memoryLimitMB, caseCount }]
//   public/problems/<slug>.json          — the full problem incl. every test case
//
// All test cases are public (practice only), so shipping them to the browser
// is the whole point.

const BASE = `${import.meta.env.BASE_URL || '/'}problems/`;

let _indexPromise = null;
const _problemCache = new Map();

/** [{ slug, title, difficulty, ... }] — cached for the session. */
export function loadIndex() {
  if (!_indexPromise) {
    _indexPromise = fetch(`${BASE}index.json`)
      .then((r) => { if (!r.ok) throw new Error(`problems index ${r.status}`); return r.json(); })
      .catch((e) => { _indexPromise = null; throw e; });
  }
  return _indexPromise;
}

/** The full problem (statement + all test cases). Cached per slug. */
export async function loadProblem(slug) {
  if (_problemCache.has(slug)) return _problemCache.get(slug);
  const p = fetch(`${BASE}${encodeURIComponent(slug)}.json`)
    .then((r) => { if (!r.ok) throw new Error(`problem ${slug} ${r.status}`); return r.json(); })
    .catch((e) => { _problemCache.delete(slug); throw e; });
  _problemCache.set(slug, p);
  return p;
}

export const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 };

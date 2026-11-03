// client/src/judge/checker.js
// ── Output checkers — kept in sync with server/src/judge/checkers ────────────
// The client practice judge and the server judge MUST agree on what "correct"
// means, so this is a direct port of the server's checkers:
//   exact    line by line, trailing spaces and blank lines ignored (default)
//   float    token by token, numbers within 1e-6 (relative, 1e-9 absolute)
//   tokens   token by token: spacing and line breaks don't matter
//   strict   character for character; only CRLF and one final newline forgiven
//   check07  problem-specific: random index of the most frequent value
//   check10  problem-specific: pair whose sum is closest to x
// The two problem-specific checkers also read the test's input.

export function norm(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

export function exactChecker(actual, expected) {
  return norm(actual) === norm(expected);
}

const ABS_EPS = 1e-9;
const REL_EPS = 1e-6;

export function floatChecker(actual, expected) {
  const a = norm(actual).split(/\s+/).filter(Boolean);
  const e = norm(expected).split(/\s+/).filter(Boolean);
  if (a.length !== e.length) return false;
  for (let i = 0; i < e.length; i++) {
    const an = Number(a[i]);
    const en = Number(e[i]);
    if (Number.isFinite(an) && Number.isFinite(en)) {
      if (Math.abs(an - en) > Math.max(ABS_EPS, REL_EPS * Math.abs(en))) return false;
    } else if (a[i] !== e[i]) {
      return false;
    }
  }
  return true;
}

const tokens = (s) => String(s).split(/\s+/).filter(Boolean);
const isInt = (t) => /^[+-]?\d+$/.test(t);

export function tokensChecker(actual, expected) {
  const a = tokens(actual);
  const e = tokens(expected);
  return a.length === e.length && a.every((t, i) => t === e[i]);
}

export function strictChecker(actual, expected) {
  const trim = (s) => String(s).replace(/\r\n/g, '\n').replace(/\n$/, '');
  return trim(actual) === trim(expected);
}

// Expected output is "CANDIDATES i1 i2 …" (the indices of the most frequent
// value); input line 1 is "n R". All R picks must be candidates, spread evenly.
export function check07(actual, expected, input) {
  const cand = tokens(expected).slice(1).map(Number);
  const isCand = new Set(cand);
  const R = Number(tokens(input)[1]);
  const out = tokens(actual);
  if (out.length !== R || !out.every(isInt)) return false;
  const picks = out.map(Number);
  if (picks.some((p) => !isCand.has(p))) return false;
  const c = cand.length;
  if (c === 1 || R < 2) return true;
  const cnt = new Map();
  for (const p of picks) cnt.set(p, (cnt.get(p) || 0) + 1);
  const mean = R / c;
  if (mean >= 30) {                       // every index should get about R/c picks
    const sd = Math.sqrt(R * (1 / c) * (1 - 1 / c));
    return cand.every((i) => Math.abs((cnt.get(i) || 0) - mean) <= 6 * sd);
  }
  if (R >= 3 * c || R >= 1000) {          // chi-square on the counts
    let chi = 0;
    for (const i of cand) chi += ((cnt.get(i) || 0) - mean) ** 2 / mean;
    const df = c - 1;
    if (Math.abs(chi - df) > 8 * Math.sqrt(2 * df) + 10) return false;
    if (cnt.size === 1) return false;
  }
  return true;
}

// Input is "n x" then n sorted 32-bit integers. Any two elements at different
// indices whose |a + b − x| equals the expected pair's is accepted.
export function check10(actual, expected, input) {
  const t = tokens(input);
  const n = Number(t[0]);
  const x = Number(t[1]);
  const have = new Map();
  for (const v of t.slice(2, 2 + n)) have.set(Number(v), (have.get(Number(v)) || 0) + 1);
  const out = tokens(actual);
  if (out.length !== 2 || !out.every(isInt)) return false;
  const [a, b] = out.map(Number);
  const need = new Map();
  for (const v of [a, b]) need.set(v, (need.get(v) || 0) + 1);
  for (const [v, k] of need) if ((have.get(v) || 0) < k) return false;
  const [ea, eb] = tokens(expected).map(Number);
  return Math.abs(a + b - x) === Math.abs(ea + eb - x);
}

const CHECKERS = { exact: exactChecker, float: floatChecker, tokens: tokensChecker, strict: strictChecker, check07, check10 };

export function check(checkerType, actual, expected, input = '') {
  return (CHECKERS[checkerType] || exactChecker)(actual, expected, input);
}

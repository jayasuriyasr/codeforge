// client/src/judge/checker.js
// ── Output checkers — kept in sync with server/src/judge/checkers ────────────
// The client practice judge and the server judge MUST agree on what "correct"
// means, so this is a direct port of the server's `exact` and `float` checkers.

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

export function check(checkerType, actual, expected) {
  return checkerType === 'float' ? floatChecker(actual, expected) : exactChecker(actual, expected);
}

// client/src/judge/index.js
// ── In-browser practice judge ──────────────────────────────────────────────
//
// Practice problems have every test case public, so they are judged entirely in
// the browser — zero server compute. Mirrors a real judge's per-case pipeline:
// run each case → map to OK/TLE/MLE/RE → check OK output for AC/WA → stop at the
// first non-AC.
//
// Languages, all client-side:
//   javascript  Web Worker (native)
//   python      Pyodide (CPython → WASM), from jsDelivr
//   c / c++     Emscripten/Clang in WASM (emception), from jsDelivr        ⚠ experimental
//   java        CheerpJ (full JRE → WASM), from Leaning Technologies' CDN  ⚠ experimental
//
// Resource verdicts:
//   TLE  wall clock — the run is terminated at the limit
//   MLE  Python / C / C++: real (the WASM heap is a single growable region we
//        measure and cap). JavaScript: best-effort. Java: from OutOfMemoryError.
//
// Non-authoritative by design (a browser can't hard-enforce like a cgroup can),
// but for practice it's accurate enough to be useful.

import { check } from './checker.js';
import { runJavascript } from './runners/javascript.js';
import { runPython, initPython } from './runners/python.js';
import { prefetchToolchain, toolchainFor } from './loader.js';

// C/C++ (emception) and Java (CheerpJ) pull in heavy glue code, so their
// runners are code-split — the chunk only loads when someone actually picks
// that language. Both "toolchain unavailable" errors carry
// `.name === 'ToolchainUnavailable'` so we can recognise them without holding
// a reference to the class.
const _mods = {};
function loadRunner(which) {
  if (!_mods[which]) {
    _mods[which] = which === 'java'
      ? import('./runners/java.js')
      : import('./runners/cpp.js');
  }
  return _mods[which];
}
const isUnavailable = (err) => err && err.name === 'ToolchainUnavailable';

async function runCpp(code, input, tl, ml, lang) {
  const m = await loadRunner('cpp');
  return m.runCpp(code, input, tl, ml, lang);
}
async function runJava(code, input, tl, ml) {
  const m = await loadRunner('java');
  return m.runJava(code, input, tl, ml);
}

// Always-on. C/C++/Java are behind an availability check (below).
const STABLE = new Set(['javascript', 'python']);
const EXPERIMENTAL = new Set(['c', 'cpp', 'java']);

export const ALL_CLIENT_LANGS = [...STABLE, ...EXPERIMENTAL];

// availability cache: lang -> { ok: boolean, error: string|null } | 'checking'
const _avail = new Map();

export function supportsClientJudge(language) {
  if (STABLE.has(language)) return true;
  if (!EXPERIMENTAL.has(language)) return false;
  const a = _avail.get(language === 'c' ? 'cpp' : language);
  return a && a !== 'checking' ? a.ok : true; // optimistic until a smoke test says otherwise
}

/**
 * Lightweight readiness check for an experimental toolchain — does the
 * environment support it at all? (COI for C/C++, browser for Java.) It does NOT
 * compile anything; the first real Judge does the heavy download. Cached.
 *
 * Pass { deep: true } to actually compile+run a hello-world (used by VERIFY.md).
 */
export async function checkToolchain(language, { deep = false } = {}) {
  const key = language === 'c' ? 'cpp' : language;
  if (!EXPERIMENTAL.has(key)) return { ok: true, error: null };
  const cached = _avail.get(key);
  if (cached && cached !== 'checking' && !deep) return cached;

  if (deep) {
    const m = await loadRunner(key === 'java' ? 'java' : 'cpp');
    const test = key === 'java' ? m.javaSmokeTest : m.cppSmokeTest;
    const res = await test().catch((e) => ({ ok: false, error: e.message }));
    _avail.set(key, res);
    return res;
  }

  _avail.set(key, 'checking');
  let res;
  if (key === 'cpp') {
    res = (typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated)
      ? { ok: true, error: null }
      : { ok: false, error: 'this page is not cross-origin isolated — C/C++ needs COOP/COEP headers' };
  } else {
    res = (typeof window !== 'undefined' && typeof document !== 'undefined')
      ? { ok: true, error: null }
      : { ok: false, error: 'Java needs a full browser environment' };
  }
  _avail.set(key, res);
  return res;
}

/** Warm a toolchain download when the user picks / hovers a language. */
export function warmup(language) {
  if (language === 'python') { initPython().catch(() => {}); return; }
  prefetchToolchain(language);
}

export function toolchainInfo(language) {
  return toolchainFor(language);
}

const RUNNERS = {
  javascript: (code, input, tl, ml) => runJavascript(code, input, tl, ml),
  python: (code, input, tl, ml) => runPython(code, input, tl, ml),
  c: (code, input, tl, ml) => runCpp(code, input, tl, ml, 'c'),
  cpp: (code, input, tl, ml) => runCpp(code, input, tl, ml, 'cpp'),
  java: (code, input, tl, ml) => runJava(code, input, tl, ml),
};

const VERDICT_FROM_STATUS = { TLE: 'TLE', MLE: 'MLE', RE: 'RE', CE: 'CE', OLE: 'RE' };

/**
 * Run ONE case, keeping actualOutput for display. Used by "Run Samples".
 * status: 'AC'|'WA'|'TLE'|'MLE'|'RE'|'CE'|'UNSUPPORTED'|'UNAVAILABLE'
 */
export async function runSample({ language, code, input, expectedOutput, checkerType = 'exact', timeLimitSec = 2, memoryLimitMB }) {
  const run = RUNNERS[language];
  if (!run) return { status: 'UNSUPPORTED' };
  let r;
  try {
    r = await run(code, input ?? '', Math.round(timeLimitSec * 1000), memoryLimitMB ?? Infinity);
  } catch (err) {
    if (isUnavailable(err)) return { status: 'UNAVAILABLE', actualOutput: err.message };
    return { status: 'RE', error: String(err.message || err), actualOutput: '' };
  }
  if (r.status === 'CE') return { status: 'CE', actualOutput: r.compileError || 'compilation failed', wallMs: r.wallMs };
  if (r.status !== 'OK') return { status: r.status, actualOutput: r.error || `(${r.status})`, wallMs: r.wallMs, memMb: r.memMb };
  const ok = check(checkerType, r.stdout, expectedOutput ?? '');
  return { status: ok ? 'AC' : 'WA', actualOutput: String(r.stdout).trimEnd(), wallMs: r.wallMs, memMb: r.memMb };
}

/**
 * Run code on the user's own input and return what it printed. There is no
 * expected answer, so no AC/WA — only whether it ran (OK) or failed to
 * (CE/RE/TLE/MLE). Used by the "Custom input" tab.
 * status: 'OK'|'TLE'|'MLE'|'RE'|'CE'|'UNSUPPORTED'|'UNAVAILABLE'
 */
export async function runCustom({ language, code, input, timeLimitSec = 2, memoryLimitMB }) {
  const run = RUNNERS[language];
  if (!run) return { status: 'UNSUPPORTED', output: '' };
  let r;
  try {
    r = await run(code, input ?? '', Math.round(timeLimitSec * 1000), memoryLimitMB ?? Infinity);
  } catch (err) {
    if (isUnavailable(err)) return { status: 'UNAVAILABLE', output: err.message };
    return { status: 'RE', output: String(err.message || err) };
  }
  if (r.status === 'CE') return { status: 'CE', output: r.compileError || 'compilation failed', wallMs: r.wallMs };
  if (r.status !== 'OK') {
    const printed = r.stdout ? `${String(r.stdout).trimEnd()}\n` : '';
    return { status: r.status === 'OLE' ? 'RE' : r.status, output: printed + (r.error || ''), wallMs: r.wallMs, memMb: r.memMb };
  }
  return { status: 'OK', output: String(r.stdout ?? '').trimEnd(), wallMs: r.wallMs, memMb: r.memMb };
}

/**
 * Judge a submission against every test case, in the browser.
 * @returns {Promise<{ verdict, runtimeMs, memoryMB, compileError, cases[], failedIndex, failedTestCase }>}
 */
export async function judgePractice({ language, code, problem, onProgress, runner }) {
  const run = runner || RUNNERS[language];
  if (!run) throw new Error(`no in-browser runner for ${language}`);

  const cases = problem.testCases || [];
  const limitMs = Math.round((problem.timeLimitSec || 2) * 1000);
  const memLimit = Number(problem.memoryLimitMB) || Infinity;
  const checkerType = problem.checkerType || 'exact';

  const results = [];
  let verdict = 'AC';
  let failedIndex = null;
  let failedTestCase = null;
  let compileError = null;
  let runtimeMs = 0;
  let memoryMB = 0;

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    let r;
    try {
      r = await run(code, tc.input ?? '', limitMs, memLimit);
    } catch (err) {
      if (isUnavailable(err)) {
        return { verdict: 'UNAVAILABLE', error: err.message, cases: [], runtimeMs: 0, memoryMB: 0, failedIndex: null, failedTestCase: null, compileError: null };
      }
      r = { status: 'RE', wallMs: 0, memMb: 0, stdout: '', error: String(err.message || err) };
    }

    // Compile errors abort the whole submission.
    if (r.status === 'CE') {
      return { verdict: 'CE', compileError: r.compileError || 'compilation failed', cases: [], runtimeMs: r.wallMs || 0, memoryMB: 0, failedIndex: null, failedTestCase: null };
    }

    runtimeMs = Math.max(runtimeMs, r.wallMs || 0);
    memoryMB = Math.max(memoryMB, r.memMb || 0);

    const caseVerdict = r.status === 'OK'
      ? (check(checkerType, r.stdout, tc.expectedOutput ?? '') ? 'AC' : 'WA')
      : (VERDICT_FROM_STATUS[r.status] || 'RE');

    results.push({ index: i, status: caseVerdict, wallMs: r.wallMs, memMb: r.memMb });
    onProgress?.({ done: i + 1, total: cases.length, case: results[i] });

    if (caseVerdict !== 'AC') {
      verdict = caseVerdict;
      failedIndex = i;
      failedTestCase = {
        input: tc.input ?? '',
        expectedOutput: tc.expectedOutput ?? '',
        actualOutput: r.status === 'OK' ? r.stdout : (r.error || `(${r.status})`),
        label: tc.label,
      };
      break;
    }
  }

  return { verdict, runtimeMs, memoryMB, compileError, cases: results, failedIndex, failedTestCase };
}

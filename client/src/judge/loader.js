// judge/loader.js
// ── Toolchain registry + prefetch ──────────────────────────────────────────
// Metadata for the five client-side languages. The heavy bytes are pulled at
// runtime from a free, unmetered CDN (jsDelivr for Python/C/C++, Leaning
// Technologies' CDN for Java) and held by the service worker + IndexedDB, so
// each toolchain is a one-time download per browser and works offline after.
//
// The actual loading lives in the runners:
//   python  runners/python.js   — Pyodide via importScripts
//   c / c++ runners/cpp.js      — @gameguild/emception-browser (npm) + CDN payload
//   java    runners/java.js     — CheerpJ 4.3 loader script
//
// Versions are PINNED in each runner. Bumping one is a deliberate change: update
// the runner and the TOOL cache version in public/sw.js together.

export const TOOLCHAINS = {
  python: {
    label: 'Python (Pyodide)',
    approxMB: 12,
    probe: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js',
  },
  cpp: {
    label: 'C / C++ (Clang → WebAssembly)',
    approxMB: 45,          // clang + lld + libc + headers, Brotli-compressed, first compile
    // emception; loaded by runners/cpp.js. Needs cross-origin isolation.
    probe: 'https://cdn.jsdelivr.net/npm/emception@4.4.0/cdn/manifest.json',
  },
  c: null,                 // shares the cpp toolchain
  java: {
    label: 'Java (CheerpJ)',
    approxMB: 20,
    // CheerpJ 4.3 — loaded by runners/java.js. Free for educational use.
    probe: 'https://cjrtnc.leaningtech.com/4.3/loader.js',
  },
  javascript: null,        // native, nothing to load
};

function key(lang) {
  return lang === 'c' ? 'cpp' : lang;
}

export function toolchainFor(lang) {
  return TOOLCHAINS[key(lang)] || null;
}

/**
 * Warm the browser cache for a language's toolchain without running anything.
 * Safe to call on hover / language-select.
 */
export async function prefetchToolchain(lang) {
  const tc = toolchainFor(lang);
  if (!tc || !tc.probe) return;
  try {
    // `cors` (not `no-cors`): the CDNs send `Access-Control-Allow-Origin: *`,
    // and an opaque response can't be used on a cross-origin-isolated page.
    await fetch(tc.probe, { mode: 'cors', cache: 'force-cache' });
  } catch {
    /* offline / blocked — the runner surfaces a clear error when used */
  }
}

/** Best-effort "is this toolchain's entry point already cached?" for the UI. */
export async function isToolchainCached(lang) {
  const tc = toolchainFor(lang);
  if (!tc || !tc.probe) return true;
  if (!('caches' in window)) return false;
  try {
    const hit = await caches.match(tc.probe, { ignoreVary: true, ignoreSearch: true });
    return !!hit;
  } catch {
    return false;
  }
}

// ── Java compiler availability ─────────────────────────────────────────────
// CheerpJ runs javac from tools.jar, which it reads through its /app/ mount —
// i.e. from THIS site's root (/tools.jar). If the file isn't deployed, a host
// answers with the SPA's index.html instead, so check the content type.
let _javacProbe = null;
export function javaCompilerHosted() {
  _javacProbe ||= fetch('/tools.jar', { method: 'HEAD', cache: 'no-store' })
    .then((r) => r.ok && !/text\/html/i.test(r.headers.get('content-type') || ''))
    .catch(() => false);
  return _javacProbe;
}

export const JAVA_NOT_HOSTED =
  'Java isn\u2019t enabled on this site yet — its compiler file (tools.jar) isn\u2019t deployed. Please use another language for now.';

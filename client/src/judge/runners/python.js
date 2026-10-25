// client/src/judge/runners/python.js
// ── In-browser Python runner (Pyodide / real CPython → WASM) ────────────────
// A long-lived Web Worker hosts Pyodide (first init ~2-4 s, then reused).
//
// TLE  — wall clock; the worker is terminated if a run overruns the limit.
// MLE  — REAL: Pyodide's whole heap is one WebAssembly.Memory that only grows,
//        so `wasmMemory.buffer.byteLength − (size right after init)` is the peak
//        bytes the solution forced to be allocated. If that exceeds the limit,
//        or Python raises MemoryError (grow() refused), the verdict is MLE.
//        Because the heap never shrinks, a run after a memory-heavy one would
//        inherit its size. So an over-limit reading only counts if the run
//        started from a clean heap; otherwise Pyodide is restarted and the test
//        run again. A batch that leaves the heap grown also gets a fresh
//        Pyodide once the page is idle, so the next batch reads clean numbers.
//
// Asset source (first that loads wins): VITE_PYODIDE_URL, /pyodide/, then the CDN.

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const CONFIGURED = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PYODIDE_URL) || '';

const WORKER_SRC = `
const MEM_ERR_RE = /MemoryError|out of memory|Cannot enlarge memory|memory access out of bounds|RangeError|Aborted/i;
let ready = null;

function heapBytes() {
  const m = self.__py && self.__py._module;
  if (!m) return 0;
  if (m.wasmMemory && m.wasmMemory.buffer) return m.wasmMemory.buffer.byteLength;
  if (m.HEAPU8) return m.HEAPU8.length;
  return 0;
}

async function boot(indexURL) {
  importScripts(indexURL + 'pyodide.js');
  self.__py = await loadPyodide({ indexURL });
  // One throwaway run so the baseline captures post-warmup heap (first
  // runPythonAsync + 'import gc' grow the WASM heap ~10-30 MB one time).
  try { await self.__py.runPythonAsync('import gc, sys, io\\ngc.collect()'); } catch (_) {}
  self.__baseline = heapBytes();
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === 'init') {
    if (!ready) {
      ready = (async () => {
        let lastErr;
        for (const u of e.data.urls) { try { await boot(u); return; } catch (err) { lastErr = err; } }
        throw lastErr;
      })();
    }
    try { await ready; self.postMessage({ type: 'ready' }); }
    catch (err) { self.postMessage({ type: 'initError', error: String(err && err.message || err) }); }
    return;
  }

  if (type === 'run') {
    const { code, input, id } = e.data;
    const py = self.__py;
    let before = 0;
    try {
      try { py.runPython('import gc; gc.collect()'); } catch (_) {}   // release last run's objects

      // Feed stdin via the low-level byte interface. The high-level {stdin: ()=>str}
      // callback only ever delivers its first ~8 KiB when autoEOF is on, so a big
      // sys.stdin.read() would silently truncate. read(buf) is re-called until EOF.
      const inbytes = new TextEncoder().encode(String(input));
      let pos = 0;
      py.setStdin({
        read: (buf) => {
          if (pos >= inbytes.length) return 0;              // EOF
          const n = Math.min(buf.length, inbytes.length - pos);
          buf.set(inbytes.subarray(pos, pos + n));
          pos += n;
          return n;
        },
      });
      let out = '';
      py.setStdout({ batched: (s) => { out += s + '\\n'; } });
      py.setStderr({ batched: () => {} });

      // The run's variables live in this dict. Empty and release it afterwards:
      // a PyProxy keeps the whole namespace (e.g. a 10^5-element dp list) alive
      // until JS garbage collection, so the heap reading crept up case by case.
      const globals = py.toPy({});
      before = heapBytes();
      try {
        await py.runPythonAsync(code, { globals });
      } finally {
        try { globals.clear(); } catch (_) {}
        globals.destroy();
      }
      self.postMessage({ type: 'result', id, ok: true, stdout: out, before, heap: heapBytes(), baseline: self.__baseline });
    } catch (err) {
      const msg = String(err && err.message || err);
      self.postMessage({
        type: 'result', id, ok: false, error: msg,
        oom: MEM_ERR_RE.test(msg),
        before, heap: heapBytes(), baseline: self.__baseline,
      });
    }
  }
};
`;

let worker = null;
let initPromise = null;

function ensureWorker() {
  if (!worker) worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' })));
  return worker;
}

export function initPython() {
  if (initPromise) return initPromise;
  const w = ensureWorker();
  const urls = [CONFIGURED, '/pyodide/', PYODIDE_CDN].filter(Boolean);
  initPromise = new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.type === 'ready') { w.removeEventListener('message', onMsg); resolve(); }
      else if (e.data.type === 'initError') { w.removeEventListener('message', onMsg); initPromise = null; reject(new Error(e.data.error)); }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'init', urls });
  });
  return initPromise;
}

let seq = 0;
const MB = 1024 * 1024;
const CLEAN_MB = 16;          // heap grown less than this since init counts as clean
const RECYCLE_IDLE_MS = 1500; // a run starting later than this is a new batch

let recycleTimer = null;

function restartPython() {
  worker?.terminate(); worker = null; initPromise = null;
}

/**
 * @param {string} code
 * @param {string} input
 * @param {number} timeLimitMs
 * @param {number} [memLimitMb]   peak-allocation ceiling; exceeding it → status 'MLE'
 * @returns {Promise<{status:'OK'|'TLE'|'MLE'|'RE', wallMs:number, memMb:number, stdout:string, error?:string}>}
 */
export async function runPython(code, input, timeLimitMs, memLimitMb = Infinity, isRetry = false) {
  clearTimeout(recycleTimer);
  await initPython();
  const w = ensureWorker();
  const id = ++seq;
  const start = performance.now();
  const SLACK_MB = 8;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.removeEventListener('message', onMsg);
      restartPython();   // Pyodide can't be interrupted → kill it
      resolve({ status: 'TLE', wallMs: Math.round(performance.now() - start), memMb: 0, stdout: '' });
    }, timeLimitMs + 400);

    const onMsg = (e) => {
      if (e.data.type !== 'result' || e.data.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMsg);
      const wallMs = Math.round(performance.now() - start);
      const baseline = e.data.baseline || 0;
      const memMb = Math.max(0, ((e.data.heap || 0) - baseline) / MB);
      const overMem = e.data.oom || memMb > memLimitMb + SLACK_MB;
      const startedClean = ((e.data.before || 0) - baseline) / MB <= CLEAN_MB;
      const dirtyAfter = memMb > CLEAN_MB;

      // Over the limit, but part of the heap was left by an earlier run: measure
      // this test again on a fresh heap and let that result stand.
      if (overMem && !startedClean && !isRetry) {
        restartPython();
        return resolve(runPython(code, input, timeLimitMs, memLimitMb, true));
      }
      if (dirtyAfter) {
        recycleTimer = setTimeout(() => { restartPython(); initPython().catch(() => {}); }, RECYCLE_IDLE_MS);
      }

      if (overMem) return resolve({ status: 'MLE', wallMs, memMb, stdout: e.data.stdout || '' });
      if (!e.data.ok) return resolve({ status: 'RE', wallMs, memMb, stdout: '', error: e.data.error });
      if (wallMs > timeLimitMs) return resolve({ status: 'TLE', wallMs, memMb, stdout: e.data.stdout });
      resolve({ status: 'OK', wallMs, memMb, stdout: e.data.stdout });
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'run', code, input: String(input ?? ''), id });
  });
}

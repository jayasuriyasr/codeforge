// client/src/judge/runners/python.js
// ── In-browser Python runner (Pyodide / real CPython → WASM) ────────────────
// One long-lived Web Worker hosts Pyodide and is reused for every run. The
// numbers below were measured on the live site (Pyodide 0.26.4, CPython 3.12).
//
// START (once per page): load Pyodide with snapshot-making on, take a 20 MB
//   snapshot of the fresh interpreter and keep using the same instance; install
//   the interrupt handler and the memory guard; run a warm-up (lets the browser
//   optimise CPython and loads common modules) and a short benchmark that sets
//   this device's speed factor (a slow device gets up to 3× the time limit).
//
// PER PROBLEM: pre-grow the WASM heap to the cap (Pyodide + memory limit +
//   8 MB) and write one 0 into every 4 KB page, so the first big test pays no
//   growth calls and no page faults (40,443 → 104 faults measured). The 0s cost
//   real RAM, so they are only written on devices with 8 GB or more.
//
// PER TEST: only the program is timed, inside the worker — not the setup,
//   gc.collect() or freeing the program's objects (up to 160 ms).
//
// TLE, three layers:
//   1. at 1.5 × the limit (at most 3 s past it) the page writes 2 (SIGINT) into a SharedArrayBuffer;
//      Pyodide reads it on loop jump-backs and raises in the program (2–8 ms);
//   2. our SIGINT handler also switches sys.monitoring on for user code, so a
//      program that catches the interrupt is stopped at its next loop step or
//      call (costs nothing before the limit);
//   3. 200 ms later the worker is terminated — loop-free recursion and one long
//      C call (sum(range(10**10))) never read the buffer. A fresh Pyodide is
//      restored from the snapshot in the background.
//   A run that finishes between 1× and 1.5× the limit is run once more and the
//   faster time counts: browsers only have wall-clock time.
//
// MLE: the heap is already at the cap, so any growth is over the limit; the
//   guard refuses it, Python raises MemoryError, and the run is MLE even if the
//   program catches it. Memory is read from the allocator (exact), not the heap
//   size. Freed memory stays in the allocator in pieces, so a refusal on a heap
//   that earlier tests used is re-checked on a fresh Pyodide before it counts.
//   After an MLE the same Pyodide is kept if a health check passes.
//
// Every Pyodide internal used here is feature-checked; without one, the runner
// falls back to the simpler behaviour (no snapshot → full reload; no interrupt
// → terminate; no allocator counter → heap-size reading, no pre-growing).
//
// Asset source (first that loads wins): VITE_PYODIDE_URL, /pyodide/, then the CDN.

import { MB, SLACK_MB, CLEAN_MB, KILL_AFTER_MS, SIGINT, deviceFactor, decide, stopAtMs } from './pyPolicy.js';

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const CONFIGURED = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PYODIDE_URL) || '';
const URLS = [CONFIGURED, '/pyodide/', PYODIDE_CDN].filter(Boolean);

const RECYCLE_IDLE_MS = 1500;   // a run starting later than this is a new submission
const HEALTH_LIMIT_MS = 2000;

// Python run by the judge itself (compiled as "<judge>"; user code is "<user>").
const JUDGE_PY = `import gc, signal, sys
_M = getattr(sys, "monitoring", None)
_TOOL = 3
_NAME = "codeforge-judge"
_armed = [False]

def _kill(code, *rest):
    if _armed[0] and code.co_filename == "<user>":
        raise TimeoutError("time limit exceeded")

def _on_interrupt(signum, frame):
    _armed[0] = True
    if _M is not None:
        try:
            _M.set_events(_TOOL, _M.events.JUMP | _M.events.PY_START)
        except Exception:
            pass
    raise TimeoutError("time limit exceeded")

def _claim():
    if _M is None:
        return
    if _M.get_tool(_TOOL) != _NAME:
        if _M.get_tool(_TOOL) is not None:
            _M.free_tool_id(_TOOL)
        _M.use_tool_id(_TOOL, _NAME)
    _M.register_callback(_TOOL, _M.events.JUMP, _kill)
    _M.register_callback(_TOOL, _M.events.PY_START, _kill)
    _M.set_events(_TOOL, 0)

def prepare():
    _armed[0] = False
    try:
        signal.signal(signal.SIGINT, _on_interrupt)
    except Exception:
        pass
    try:
        _claim()
    except Exception:
        pass
    gc.collect()

def finish():
    fired = _armed[0]
    _armed[0] = False
    if _M is not None:
        try:
            _M.set_events(_TOOL, 0)
        except Exception:
            pass
    return fired
`;

// Exercises the interpreter's common paths with little memory, so the browser
// has optimised CPython before the first test (a restored Pyodide ran up to
// 1.6× slower without it) and the usual modules are already imported.
const WARMUP_PY = `import heapq, collections, bisect, math, itertools, functools, re, json
d = {}
for i in range(200000):
    d[i & 1023] = str(i)
s = sorted(d.values())
a = [(i * 7919) & 1023 for i in range(100000)]
heapq.heapify(a)
a.sort()
t = sum(range(100000)) + len(json.dumps(s[:50])) + len(re.findall("1", "".join(s[:200])))
q = collections.deque(range(1000))
q.rotate(7)
def f(n):
    return n if n < 2 else f(n - 1) + f(n - 2)
f(18)
`;

// Device-speed benchmark: its time here vs REF_BENCH_MS sets the speed factor.
const BENCH_PY = `s = 0
for i in range(200000):
    s += (i * i) % 7
d = {}
for i in range(20000):
    d[i] = i * 2
x = sorted(d.values(), reverse=True)
def f(n):
    return n if n < 2 else f(n - 1) + f(n - 2)
f(16)
`;

const WORKER_SRC = `
const MEM_ERR_RE = /MemoryError|out of memory|Cannot enlarge memory|memory access out of bounds|Aborted/i;
const MB = ${MB};

// Memory guard: while a program runs, any WebAssembly.Memory growth past capBytes
// is refused. Pyodide then raises MemoryError. lastRefused tracks only the most
// recent request (a refused +20 % followed by an accepted +5 % is not an MLE).
const realGrow = WebAssembly.Memory.prototype.grow;
let capBytes = Infinity;
let lastRefused = false;
WebAssembly.Memory.prototype.grow = function (pages) {
  if (this.buffer.byteLength + pages * 65536 > capBytes) {
    lastRefused = true;
    throw new RangeError('memory limit');
  }
  lastRefused = false;
  return realGrow.call(this, pages);
};

let py = null, mod = null, judge = null, ia = null, feat = null, base = null, touchedTo = 0;
const now = () => performance.now();
const heapBytes = () => (mod && mod.HEAPU8 ? mod.HEAPU8.length : 0);
const footprint = () => (feat.footprint ? mod._malloc_max_footprint() >>> 0 : heapBytes());
const brk = () => (feat.sbrk ? mod._sbrk(0) >>> 0 : heapBytes());
const capFor = (memLimitMb) => Number.isFinite(memLimitMb)
  ? Math.ceil((base.top + (memLimitMb + ${SLACK_MB}) * MB) / 65536) * 65536
  : Infinity;
// Growth allowed during a run: 5 % over the cap, because Pyodide's smallest
// growth step is +5 % of the heap.
const runCapFor = (memLimitMb) => {
  if (!Number.isFinite(memLimitMb)) return Infinity;
  return feat.preGrow ? 1.05 * capFor(memLimitMb) : 1.05 * (base.heap + (memLimitMb + ${SLACK_MB}) * MB);
};

async function runJudgeCode(code) {
  const g = py.toPy({});
  try { await py.runPythonAsync(code, { globals: g, filename: '<judge>' }); }
  finally { try { g.clear(); } catch (_) {} g.destroy(); }
}

function retry(fn) {
  // A late interrupt can land in the judge's own Python; it raises once.
  for (let i = 0; i < 3; i++) { try { return fn(); } catch (_) {} }
  return undefined;
}

async function boot(d) {
  let lastErr;
  for (const url of d.urls) {
    try {
      importScripts(url + 'pyodide.js');
      const opts = { indexURL: url };
      if (d.snapshot) opts._loadSnapshot = d.snapshot;
      else if (d.makeSnapshot) opts._makeSnapshot = true;
      try {
        py = await loadPyodide(opts);
      } catch (err) {
        if (!opts._loadSnapshot && !opts._makeSnapshot) throw err;
        py = await loadPyodide({ indexURL: url });   // snapshot API unavailable or rejected
        opts._loadSnapshot = opts._makeSnapshot = undefined;
      }
      mod = py._module;
      feat = {
        footprint: typeof mod._malloc_max_footprint === 'function',
        sbrk: typeof mod._sbrk === 'function',
        resize: typeof mod._emscripten_resize_heap === 'function',
        interrupt: Boolean(d.sab) && typeof py.setInterruptBuffer === 'function',
      };
      feat.preGrow = feat.footprint && feat.sbrk && feat.resize;
      await py.runPythonAsync('import gc, sys, io\\ngc.collect()');
      let snapshot = null;
      if (opts._makeSnapshot && typeof py.makeMemorySnapshot === 'function') {
        try { snapshot = py.makeMemorySnapshot(); } catch (_) { snapshot = null; }
      }
      if (feat.interrupt) { ia = new Int32Array(d.sab); py.setInterruptBuffer(ia); }
      const ns = py.toPy({});
      py.runPython(d.judgePy, { globals: ns, filename: '<judge>' });
      judge = { prepare: ns.get('prepare'), finish: ns.get('finish') };
      retry(() => judge.prepare());
      let t = now();
      await runJudgeCode(d.warmupPy);
      const warmMs = now() - t;
      let benchMs = 0;
      if (d.bench) {
        benchMs = Infinity;
        for (let i = 0; i < 2; i++) { t = now(); await runJudgeCode(d.benchPy); benchMs = Math.min(benchMs, now() - t); }
      }
      py.runPython('import gc\\ngc.collect()', { filename: '<judge>' });
      base = { heap: heapBytes(), fp: footprint(), top: brk() };
      touchedTo = 0;
      return { url, snapshot, warmMs, benchMs, feat, base };
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

self.onmessage = async (e) => {
  const d = e.data;

  if (d.type === 'init') {
    try {
      const info = await boot(d);
      self.postMessage({ type: 'ready', ...info }, info.snapshot ? [info.snapshot.buffer] : []);
    } catch (err) {
      self.postMessage({ type: 'initError', error: String((err && err.message) || err) });
    }
    return;
  }

  if (d.type === 'prep') {
    // Pre-grow to the cap and back every page with a frame (one 0 per 4 KB).
    const cap = capFor(d.memLimitMb);
    let needReset = false, touched = 0;
    if (Number.isFinite(cap) && feat.preGrow) {
      if (heapBytes() > 1.05 * cap) needReset = true;        // grown for a bigger limit earlier
      else if (heapBytes() < cap) { capBytes = Infinity; try { mod._emscripten_resize_heap(cap); } catch (_) {} }
      if (!needReset && d.touch) {
        const H = mod.HEAPU8;
        const from = Math.max(brk(), touchedTo);
        for (let a = (from + 4095) & ~4095; a < H.length; a += 4096) H[a] = 0;
        touched = Math.max(0, H.length - from);
        touchedTo = H.length;
      }
    }
    self.postMessage({ type: 'prepared', id: d.id, needReset, heapMb: heapBytes() / MB, touchedMb: touched / MB });
    return;
  }

  if (d.type === 'run') {
    const { code, input, id, memLimitMb } = e.data;
    retry(() => judge.prepare());

    // stdin through the byte interface: the {stdin: () => str} form only ever
    // delivers its first ~8 KiB, so a big sys.stdin.read() would be truncated.
    const inbytes = new TextEncoder().encode(String(input));
    let pos = 0;
    py.setStdin({
      read: (buf) => {
        if (pos >= inbytes.length) return 0;
        const n = Math.min(buf.length, inbytes.length - pos);
        buf.set(inbytes.subarray(pos, pos + n));
        pos += n;
        return n;
      },
    });
    let out = '';
    py.setStdout({ batched: (s) => { out += s + '\\n'; } });
    py.setStderr({ batched: () => {} });

    // The run's variables live in this dict; it is emptied and released after.
    const globals = py.toPy({});
    const startFp = footprint();
    capBytes = runCapFor(memLimitMb);
    lastRefused = false;
    if (ia) Atomics.store(ia, 0, 0);
    self.postMessage({ type: 'started', id });

    let err = null;
    const t0 = now();
    try { await py.runPythonAsync(code, { globals, filename: '<user>' }); }
    catch (x) { err = x; }
    const runMs = now() - t0;

    if (ia) Atomics.store(ia, 0, 0);
    const refused = lastRefused;
    capBytes = Infinity;
    const fired = Boolean(retry(() => judge.finish()));
    const endFp = footprint();
    try { globals.clear(); } catch (_) {}
    try { globals.destroy(); } catch (_) {}

    const msg = err ? String((err && err.message) || err) : '';
    const baseFp = feat.footprint ? base.fp : base.heap;
    self.postMessage({
      type: 'result', id, ok: !err, error: msg, oom: Boolean(err) && MEM_ERR_RE.test(msg),
      refused, fired, runMs, stdout: out,
      memBytes: Math.max(0, endFp - baseFp), startBytes: Math.max(0, startFp - baseFp),
    });
  }
};
`;

// ── main thread ────────────────────────────────────────────────────────────

const HAS_SAB = typeof SharedArrayBuffer !== 'undefined'
  && (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated);

// Writing the 0s backs the whole cap with real RAM, so only on roomy devices.
const TOUCH_PAGES = (() => {
  const dm = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
  return typeof dm === 'number' && dm >= 8;
})();

let workerUrl = null;
let current = null;        // { worker, ia, ready, info, prepMb }
let snapshot = null;       // Uint8Array of the fresh interpreter (made once)
let workingUrl = null;
let benchMs = 0;
let factor = 1;
let recycleTimer = null;
let queue = Promise.resolve();
let seq = 0;

function spawn({ measure }) {
  workerUrl ||= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
  const worker = new Worker(workerUrl);
  const sab = HAS_SAB ? new SharedArrayBuffer(4) : null;
  const s = { worker, ia: sab ? new Int32Array(sab) : null, info: null, prepMb: undefined, dead: false };
  s.ready = new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.type === 'ready') {
        worker.removeEventListener('message', onMsg);
        s.info = e.data;
        if (e.data.snapshot) snapshot = e.data.snapshot;
        workingUrl = e.data.url;
        if (measure && e.data.benchMs > 0) { benchMs = e.data.benchMs; factor = deviceFactor(benchMs); }
        resolve(s.info);
      } else if (e.data.type === 'initError') {
        worker.removeEventListener('message', onMsg);
        reject(new Error(e.data.error));
      }
    };
    worker.addEventListener('message', onMsg);
  });
  const snapCopy = snapshot ? snapshot.slice() : null;
  worker.postMessage({
    // The benchmark always runs: it is also the last part of the warm-up (a
    // restored Pyodide ran its first program 1.6× slower without it). Only the
    // first one sets the device factor.
    type: 'init', urls: workingUrl ? [workingUrl] : URLS, sab, bench: true,
    snapshot: snapCopy, makeSnapshot: !snapshot,
    judgePy: JUDGE_PY, warmupPy: WARMUP_PY, benchPy: BENCH_PY,
  }, snapCopy ? [snapCopy.buffer] : []);
  return s;
}

function kill(s) {
  if (s.dead) return;
  s.dead = true;
  try { s.worker.terminate(); } catch { /* gone */ }
  if (current === s) current = null;
}

/** Replace the Pyodide (from the snapshot when there is one). */
function replace() {
  if (current) kill(current);
  const s = spawn({ measure: false });
  current = s;
  s.ready.catch(() => kill(s));
  return s;
}

export function initPython() {
  if (!current) {
    current = spawn({ measure: true });
    const s = current;
    s.ready.catch(() => { if (current === s) kill(s); });
  }
  return current.ready;
}

/** Speed factor of this device (≥ 1): Python time limits are multiplied by it. */
export function pythonDeviceFactor() { return factor; }

/** What the runner found at start-up (for tests and diagnostics). */
export async function pythonRuntimeInfo() {
  await initPython();
  const { feat, base, benchMs: b, warmMs } = current.info;
  return { feat, base, benchMs: b || benchMs, warmMs, factor, snapshotMb: snapshot ? snapshot.byteLength / MB : 0, interrupt: HAS_SAB, touchPages: TOUCH_PAGES };
}

/** Start from a fresh Pyodide (used by tests). */
export async function resetPython() {
  replace();
  await current.ready;
}

function request(s, msg, type) {
  return new Promise((resolve) => {
    const id = ++seq;
    const onMsg = (e) => { if (e.data.type === type && e.data.id === id) { s.worker.removeEventListener('message', onMsg); resolve(e.data); } };
    s.worker.addEventListener('message', onMsg);
    s.worker.postMessage({ ...msg, id });
  });
}

async function ready() {
  for (let attempt = 0; attempt < 2; attempt++) {
    await initPython();
    const s = current;
    try { await s.ready; return s; } catch (err) { if (attempt) throw err; }
  }
  throw new Error('Python failed to start');
}

async function prepare(s, memLimitMb) {
  if (s.prepMb === memLimitMb) return s;
  const r = await request(s, { type: 'prep', memLimitMb, touch: TOUCH_PAGES }, 'prepared');
  if (r.needReset) {
    const fresh = replace();
    await fresh.ready;
    return prepare(fresh, memLimitMb);
  }
  s.prepMb = memLimitMb;
  return s;
}

/** Run once; resolves with the raw run (never rejects). */
function execOnce(s, code, input, limitMs, memLimitMb) {
  return new Promise((resolve) => {
    const id = ++seq;
    const stopAt = Math.max(1, stopAtMs(limitMs));
    let startedAt = performance.now();
    let interruptT = null, killT = null, safetyT = null, interrupted = false, done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(interruptT); clearTimeout(killT); clearTimeout(safetyT);
      s.worker.removeEventListener('message', onMsg);
      resolve(r);
    };
    const terminate = () => {
      kill(s);
      replace();   // a fresh Pyodide comes up in the background
      finish({ killed: true, ok: false, runMs: performance.now() - startedAt, memMb: 0, startMb: 0, stdout: '' });
    };
    const onMsg = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'started') {
        startedAt = performance.now();
        if (s.ia) {
          // The 200 ms grace starts when the interrupt is actually written: if the
          // page stalls past the deadline, both timers would otherwise fire together.
          interruptT = setTimeout(() => {
            interrupted = true;
            Atomics.store(s.ia, 0, SIGINT);
            killT = setTimeout(terminate, KILL_AFTER_MS);
          }, stopAt);
        } else {
          killT = setTimeout(terminate, stopAt);
        }
      } else if (m.type === 'result') {
        finish({
          ok: m.ok, error: m.error, oom: m.oom, refused: m.refused, stdout: m.stdout,
          interrupted: interrupted || m.fired, killed: false, runMs: m.runMs,
          memMb: m.memBytes / MB, startMb: m.startBytes / MB,
        });
      }
    };
    s.worker.addEventListener('message', onMsg);
    // never reported "started" (a stuck worker): give up well after the limit
    safetyT = setTimeout(terminate, stopAt + KILL_AFTER_MS + 15000);
    s.worker.postMessage({ type: 'run', id, code, input: String(input ?? ''), memLimitMb });
  });
}

async function healthy(s) {
  if (s.dead) return false;
  const r = await execOnce(s, 'print(1 + 1)', '', HEALTH_LIMIT_MS, Infinity);
  return r.ok && !r.killed && String(r.stdout).trim() === '2';
}

/**
 * @param {string} code
 * @param {string} input
 * @param {number} timeLimitMs   the problem's limit for Python (before the device factor)
 * @param {number} [memLimitMb]  peak-allocation ceiling; exceeding it → status 'MLE'
 * @returns {Promise<{status:'OK'|'TLE'|'MLE'|'RE', wallMs:number, memMb:number, stdout:string, error?:string, limitMs:number}>}
 */
export function runPython(code, input, timeLimitMs, memLimitMb = Infinity) {
  const p = queue.then(() => runNow(code, input, timeLimitMs, memLimitMb));
  queue = p.catch(() => {});
  return p;
}

async function runNow(code, input, timeLimitMs, memLimitMb, recheck = false) {
  clearTimeout(recycleTimer);
  let s = await ready();
  s = await prepare(s, memLimitMb);
  const limitMs = Math.round(timeLimitMs * factor);

  let run = await execOnce(s, code, input, limitMs, memLimitMb);
  let verdict = decide(run, { limitMs, memLimitMb, recheck });

  if (verdict === 'RERUN') {
    // Finished between 1× and 1.5× the limit: one more run, the faster one counts.
    const again = await execOnce(await ready().then((x) => prepare(x, memLimitMb)), code, input, limitMs, memLimitMb);
    const second = decide(again, { limitMs, memLimitMb, rerun: true, recheck });
    if (second === 'OK') { run = again; verdict = 'OK'; }
    else { verdict = 'TLE'; run = { ...run, runMs: again.killed ? run.runMs : Math.min(run.runMs, again.runMs) }; }
  }

  if (verdict === 'RECHECK') {
    // Refused on a heap earlier tests had used: decide on a fresh Pyodide.
    const fresh = replace();
    await fresh.ready;
    return runNow(code, input, timeLimitMs, memLimitMb, true);
  }

  if (verdict === 'MLE' && current && !(await healthy(current))) replace();

  // A run that grew the heap leaves it dirty: refresh once the page is idle so
  // the next submission's memory readings start clean.
  if (!run.killed && run.memMb > CLEAN_MB) {
    recycleTimer = setTimeout(() => {
      const s2 = replace();
      s2.ready.then(() => prepare(s2, memLimitMb)).catch(() => {});
    }, RECYCLE_IDLE_MS);
  }

  const wallMs = Math.round(run.runMs);
  const memMb = run.memMb || 0;
  if (verdict === 'TLE') return { status: 'TLE', wallMs, memMb, stdout: '', limitMs };
  // A single refused allocation leaves the reading below the limit: show the limit.
  if (verdict === 'MLE') return { status: 'MLE', wallMs, memMb: Number.isFinite(memLimitMb) ? Math.max(memMb, memLimitMb) : memMb, stdout: run.stdout || '', limitMs };
  if (verdict === 'RE') return { status: 'RE', wallMs, memMb, stdout: '', error: run.error, limitMs };
  return { status: 'OK', wallMs, memMb, stdout: run.stdout, limitMs };
}

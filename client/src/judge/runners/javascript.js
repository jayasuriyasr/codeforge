// client/src/judge/runners/javascript.js
// ── In-browser JavaScript runner ───────────────────────────────────────────
// Runs the user's code in a throwaway Web Worker with stdin/stdout wired to
// mimic `node solution.js`: readFileSync(0), a readline() helper, process.stdin.
//
// TLE — wall clock (worker.terminate at the limit).
// MLE — only when the program actually runs out of memory:
//        · a thrown allocation error ("allocation failed")
//        · the worker dying with no result on a short run (V8 OOM)
//       A browser can't measure a worker's JS heap — `performance.memory` is
//       not exposed in workers (not even in Chrome) — so a JavaScript program
//       that merely uses more than the limit is NOT flagged. The Solve page says
//       so next to the language picker. (Python and C/C++ are measured exactly.)
//       A stack overflow ("Maximum call stack size exceeded") is a runtime error
//       (RE), as on most judges — not a memory verdict.

const WORKER_SRC = `
const MEM_ERR_RE = /allocation failed|out of memory|Array buffer allocation/i;
const STACK_RE = /Maximum call stack size exceeded/i;
const describe = (msg) => (STACK_RE.test(msg) ? 'Stack overflow — recursion too deep (' + msg + ')' : msg);
self.onmessage = (e) => {
  const { code, input } = e.data;
  let out = '';
  const write = (s) => { out += s; };
  const mem0 = (self.performance && performance.memory) ? performance.memory.usedJSHeapSize : 0;

  const origLog = console.log;
  console.log = (...a) => write(a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\\n');
  const consoleShim = { ...console, log: console.log, error: () => {}, warn: () => {}, info: console.log, debug: () => {} };

  const lines = String(input).split('\\n');
  let li = 0;
  const readline = () => (li < lines.length ? lines[li++] : '');
  const fsShim = { readFileSync: () => input, readFile: (p, opt, cb) => (cb || opt)(null, input) };
  const processShim = {
    stdin: { on(ev, cb) { if (ev === 'data') cb(input); if (ev === 'end') setTimeout(cb, 0); return this; }, once(ev, cb){ return this.on(ev, cb); }, resume(){}, setEncoding(){} },
    stdout: { write }, argv: ['node', 'solution.js'], exit: (c) => { if (c) throw new Error('exit ' + c); }, env: {},
  };
  const requireShim = (m) => {
    if (m === 'fs') return fsShim;
    if (m === 'readline') return { createInterface: () => ({ on(ev, cb){ if(ev==='line') for(const l of lines) cb(l); if(ev==='close') setTimeout(cb,0); return this; }, close(){} }) };
    if (m === 'process') return processShim;
    return {};
  };

  const peakMb = () => {
    const now = (self.performance && performance.memory) ? performance.memory.usedJSHeapSize : 0;
    return (now && mem0) ? Math.max(0, (now - mem0) / (1024 * 1024)) : 0;
  };

  let reported = false;
  const fail = (err) => {
    if (reported) return; reported = true;
    console.log = origLog;
    const msg = String((err && err.message) || err);
    self.postMessage({ ok: false, error: describe(msg), stdout: out, memMb: peakMb(), oom: MEM_ERR_RE.test(msg) });
  };
  self.addEventListener('error', (ev) => { ev.preventDefault(); fail(ev.error || ev.message); });
  self.addEventListener('unhandledrejection', (ev) => { ev.preventDefault(); fail(ev.reason); });

  try {
    const fn = new Function('console', 'readline', 'process', 'require', 'module', 'exports', code);
    fn(consoleShim, readline, processShim, requireShim, { exports: {} }, {});
    setTimeout(() => { if (reported) return; reported = true; console.log = origLog; self.postMessage({ ok: true, stdout: out, memMb: peakMb() }); }, 5);
  } catch (err) {
    fail(err);
  }
};
`;

// Every run gets a worker that has never run code, but starting one costs
// ~20 ms (20 s on a 1000-case problem). So the next run's worker is started
// while the current one runs, and dropped if no run comes to claim it.
const SPARE_IDLE_MS = 5000;
let workerUrl = null;
let spare = null;
let spareTimer = null;

function freshWorker() {
  workerUrl ||= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
  const worker = spare || new Worker(workerUrl);
  spare = new Worker(workerUrl);
  clearTimeout(spareTimer);
  spareTimer = setTimeout(() => { spare?.terminate(); spare = null; }, SPARE_IDLE_MS);
  return worker;
}

export function runJavascript(code, input, timeLimitMs, memLimitMb = Infinity) {
  return new Promise((resolve) => {
    const worker = freshWorker();
    const start = performance.now();
    const SLACK_MB = 16;
    let settled = false;
    const done = (r) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); resolve(r); };

    const timer = setTimeout(
      () => done({ status: 'TLE', wallMs: Math.round(performance.now() - start), memMb: 0, stdout: '' }),
      timeLimitMs + 200,
    );

    worker.onmessage = (e) => {
      const wallMs = Math.round(performance.now() - start);
      const memMb = e.data.memMb || 0;
      const overMem = e.data.oom || (memLimitMb !== Infinity && memMb > memLimitMb + SLACK_MB);
      if (overMem) return done({ status: 'MLE', wallMs, memMb, stdout: e.data.stdout || '' });
      if (!e.data.ok) return done({ status: 'RE', wallMs, memMb, stdout: e.data.stdout || '', error: e.data.error });
      if (wallMs > timeLimitMs) return done({ status: 'TLE', wallMs, memMb, stdout: e.data.stdout || '' });
      done({ status: 'OK', wallMs, memMb, stdout: e.data.stdout || '' });
    };
    // Worker died before posting a result. With an allocation message (or no
    // message at all, which is how a V8 out-of-memory crash looks) on a short
    // run it's MLE; any other message is an ordinary runtime error.
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      const wallMs = Math.round(performance.now() - start);
      const msg = String(ev?.message || '');
      if (wallMs >= timeLimitMs) return done({ status: 'TLE', wallMs, memMb: 0, stdout: '' });
      if (msg && !/allocation failed|out of memory|Array buffer allocation/i.test(msg)) return done({ status: 'RE', wallMs, memMb: 0, stdout: '', error: msg });
      done({ status: 'MLE', wallMs, memMb: 0, stdout: '' });
    };

    worker.postMessage({ code, input: String(input ?? '') });
  });
}

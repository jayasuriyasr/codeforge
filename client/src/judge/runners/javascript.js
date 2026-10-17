// client/src/judge/runners/javascript.js
// ── In-browser JavaScript runner ───────────────────────────────────────────
// Runs the user's code in a throwaway Web Worker with stdin/stdout wired to
// mimic `node solution.js`: readFileSync(0), a readline() helper, process.stdin.
//
// TLE — wall clock (worker.terminate at the limit).
// MLE — best effort:
//        · `performance.memory.usedJSHeapSize` delta (Chromium only)
//        · a thrown allocation error (RangeError / "allocation failed")
//        · the worker dying with no result on a short run (V8 OOM)
//       Precise JS memory limiting isn't possible from a page — Firefox / Safari
//       have no `performance.memory`, so there MLE degrades to RE. The server
//       judge (contest mode) is the authoritative path.

const WORKER_SRC = `
const MEM_ERR_RE = /allocation failed|out of memory|Maximum call stack|Array buffer allocation/i;
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

  try {
    const fn = new Function('console', 'readline', 'process', 'require', 'module', 'exports', code);
    fn(consoleShim, readline, processShim, requireShim, { exports: {} }, {});
    setTimeout(() => { console.log = origLog; self.postMessage({ ok: true, stdout: out, memMb: peakMb() }); }, 5);
  } catch (err) {
    console.log = origLog;
    const msg = String(err && err.message || err);
    self.postMessage({ ok: false, error: msg, stdout: out, memMb: peakMb(), oom: MEM_ERR_RE.test(msg) });
  }
};
`;

export function runJavascript(code, input, timeLimitMs, memLimitMb = Infinity) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
    const worker = new Worker(url);
    const start = performance.now();
    const SLACK_MB = 16;
    let settled = false;
    const done = (r) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve(r); };

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
    // Worker died before posting a result — on a short run that's almost always a V8 OOM.
    worker.onerror = () => {
      const wallMs = Math.round(performance.now() - start);
      done({ status: wallMs < timeLimitMs ? 'MLE' : 'TLE', wallMs, memMb: 0, stdout: '' });
    };

    worker.postMessage({ code, input: String(input ?? '') });
  });
}

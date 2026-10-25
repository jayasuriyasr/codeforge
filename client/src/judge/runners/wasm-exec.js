// judge/runners/wasm-exec.js
// ── Fast runner for the main.wasm that emception links ─────────────────────
//
// emception's own `wasi-run` feeds stdin ONE BYTE per `fd_read` (and logs every
// call), so a correct C/C++ solution could TLE on ~10⁵ input tokens purely on
// I/O. This runs the same binary in a dedicated Web Worker with a minimal WASI
// layer that hands over stdin in bulk. Same imports as `wasi-run` (WASI
// preview1 + stubbed emscripten `env` functions), same entry sequence
// (__wasm_call_ctors → _start or main), so programs behave identically.
//
//   TLE : wall clock measured inside the worker; past the limit (+ slack for
//         start-up) the worker is terminated — the compiler stays loaded.
//   MLE : real. A wasm heap only grows, so memory.buffer.byteLength at exit is
//         the peak. Over the limit → MLE (malloc failing at the --max-memory
//         cap surfaces as std::bad_alloc on stderr → MLE too).

const OUTPUT_CAP = 64 * 1024 * 1024;

const WORKER_SRC = `
class Exit extends Error { constructor(code) { super('exit ' + code); this.code = code; } }
class OutputLimit extends Error {}
const OUTPUT_CAP = ${OUTPUT_CAP};

self.onmessage = async (e) => {
  const { module: mod, bytes, input } = e.data;
  let memory = null, pos = 0, outLen = 0, refusedBytes = 0;
  const out = [], err = [];
  const view = () => new DataView(memory.buffer);

  const writeTo = (sink, ptr, len) => {
    if (sink === out) { outLen += len; if (outLen > OUTPUT_CAP) throw new OutputLimit(); }
    sink.push(new Uint8Array(memory.buffer, ptr, len).slice());
  };
  const wasi = {
    fd_write(fd, iovs, n, nwritten) {
      const dv = view(); let total = 0;
      for (let i = 0; i < n; i++) {
        const ptr = dv.getUint32(iovs + i * 8, true), len = dv.getUint32(iovs + i * 8 + 4, true);
        if (len && (fd === 1 || fd === 2)) writeTo(fd === 1 ? out : err, ptr, len);
        total += len;
      }
      view().setUint32(nwritten, total, true);
      return fd === 1 || fd === 2 ? 0 : 8;
    },
    fd_read(fd, iovs, n, nread) {
      const dv = view();
      if (fd !== 0) { dv.setUint32(nread, 0, true); return 8; }
      const mem = new Uint8Array(memory.buffer); let got = 0;
      for (let i = 0; i < n && pos < input.length; i++) {
        const ptr = dv.getUint32(iovs + i * 8, true), len = dv.getUint32(iovs + i * 8 + 4, true);
        const take = Math.min(len, input.length - pos);
        mem.set(input.subarray(pos, pos + take), ptr);
        pos += take; got += take;
      }
      dv.setUint32(nread, got, true);
      return 0;
    },
    fd_close: () => 0,
    fd_seek: () => 70,                        // ESPIPE: stdio isn't seekable
    fd_fdstat_get(fd, stat) {
      const dv = view();
      dv.setUint8(stat, fd <= 2 ? 2 : 4); dv.setUint16(stat + 2, 0, true);
      dv.setBigUint64(stat + 8, fd === 0 ? 2n : fd <= 2 ? 0x40n : 0n, true);
      dv.setBigUint64(stat + 16, 0n, true);
      return 0;
    },
    fd_prestat_get: () => 8, fd_prestat_dir_name: () => 8,
    environ_sizes_get(c, s) { const dv = view(); dv.setUint32(c, 0, true); dv.setUint32(s, 0, true); return 0; },
    environ_get: () => 0,
    args_sizes_get(c, s) { const dv = view(); dv.setUint32(c, 1, true); dv.setUint32(s, 5, true); return 0; },
    args_get(argv, buf) { view().setUint32(argv, buf, true); new Uint8Array(memory.buffer).set([109, 97, 105, 110, 0], buf); return 0; },
    clock_time_get(_id, _prec, t) { view().setBigUint64(t, BigInt(Math.round(performance.now() * 1e6)), true); return 0; },
    random_get(p, len) { crypto.getRandomValues(new Uint8Array(memory.buffer, p, len)); return 0; },
    proc_exit(code) { throw new Exit(code); },
    sched_yield: () => 0,
    poll_oneoff(inPtr, outPtr, nsub, nev) {
      const dv = view();
      for (let i = 0; i < nsub; i++) {
        const sub = inPtr + i * 48, ev = outPtr + i * 32;
        dv.setBigUint64(ev, dv.getBigUint64(sub, true), true);
        dv.setUint16(ev + 8, 0, true); dv.setUint8(ev + 10, dv.getUint8(sub + 8));
        dv.setBigUint64(ev + 16, 1n, true); dv.setUint16(ev + 24, 0, true);
      }
      dv.setUint32(nev, nsub, true);
      return 0;
    },
  };

  // emscripten's libc calls a few JS helpers ("env" imports). wasi-run stubbed
  // them all as "return 0": emscripten_resize_heap then reported failure, so the
  // heap could never grow past its initial ~128 KB, and a C++ throw became a
  // silent no-op. Implement the ones that matter.
  const cString = (ptr) => { const m = new Uint8Array(memory.buffer); let e = ptr; while (e < m.length && m[e]) e++; return new TextDecoder().decode(m.subarray(ptr, e)); };
  const env = {
    emscripten_resize_heap(requested) {
      requested >>>= 0;
      const cur = memory.buffer.byteLength;
      if (requested <= cur) return 1;
      // exact growth keeps memory accounting honest; a refused growth (past the
      // --max-memory cap) means the program wanted more than the limit -> MLE
      try { memory.grow(Math.ceil((requested - cur) / 65536)); return 1; } catch { refusedBytes = Math.max(refusedBytes, requested); return 0; }
    },
    emscripten_notify_memory_growth() {},
    emscripten_get_heap_max: () => 2147483648,
    emscripten_memcpy_js(dest, src, num) { new Uint8Array(memory.buffer).copyWithin(dest, src, src + num); },
    emscripten_memcpy_big(dest, src, num) { new Uint8Array(memory.buffer).copyWithin(dest, src, src + num); },
    emscripten_get_now: () => performance.now(),
    emscripten_date_now: () => Date.now(),
    __cxa_throw(_obj, tinfo) {
      let name = 'unknown type';
      try { name = cString(new DataView(memory.buffer).getUint32(tinfo + 4, true)); } catch { /* keep default */ }
      throw new Error('uncaught C++ exception: ' + (/bad_alloc/.test(name) ? 'std::bad_alloc' : name));
    },
    _tzset_js() {},
  };

  let result;
  try {
    const module = mod || await WebAssembly.compile(bytes);
    const imports = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      const ns = (imports[imp.module] ||= {});
      if (imp.module === 'wasi_snapshot_preview1' || imp.module === 'wasi_unstable') ns[imp.name] = wasi[imp.name] || (() => 52);
      else if (imp.kind === 'memory') ns[imp.name] = memory = new WebAssembly.Memory({ initial: 256, maximum: 16384 });
      else if (imp.kind === 'table') ns[imp.name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
      else if (imp.kind === 'function') ns[imp.name] = env[imp.name] || (/abort|segfault|alignfault/i.test(imp.name) ? () => { throw new Error(imp.name.replace(/^_+|_js$/g, '') + '() called'); } : () => 0);
      else throw new Error('unsupported import ' + imp.module + '.' + imp.name);
    }
    const instance = await WebAssembly.instantiate(module, imports);
    memory ||= instance.exports.memory;
    let exitCode = 0, trap = null;
    const t0 = performance.now();
    try {
      instance.exports.__wasm_call_ctors?.();
      if (instance.exports._start) instance.exports._start();
      else exitCode = Number(instance.exports.main(0, 0) ?? 0);
    } catch (x) {
      if (x instanceof Exit) exitCode = x.code;
      else if (x instanceof OutputLimit) trap = 'output limit exceeded (over 64 MB printed)';
      else trap = String((x && x.message) || x);
    }
    const runMs = performance.now() - t0;
    const dec = new TextDecoder();
    const join = (parts) => { const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return dec.decode(all); };
    result = { ok: true, exitCode, trap, runMs, memBytes: memory ? memory.buffer.byteLength : 0, refusedBytes, stdout: join(out), stderr: join(err) };
  } catch (setupError) {
    result = { ok: false, setupError: String((setupError && setupError.message) || setupError) };
  }
  self.postMessage(result);
};
`;

let _worker = null;
let _workerUrl = null;

function worker() {
  if (!_worker) {
    _workerUrl ||= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
    _worker = new Worker(_workerUrl);
  }
  return _worker;
}

function killWorker() {
  try { _worker?.terminate(); } catch { /* gone */ }
  _worker = null;
}

/**
 * Run a compiled module once.
 * @returns {Promise<null | {timedOut?:boolean, wallMs:number, exitCode?:number, trap?:string|null, memBytes?:number, stdout?:string, stderr?:string}>}
 *   null when this runner can't handle the binary — the caller then falls back
 *   to emception's own `wasi-run`.
 */
export function execWasm(module, bytes, input, timeLimitMs) {
  return new Promise((resolve) => {
    const w = worker();
    const stdin = new TextEncoder().encode(String(input ?? '').replace(/\r\n/g, '\n'));
    const started = performance.now();
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); w.onmessage = null; w.onerror = null; resolve(r); };
    // generous slack covers worker start-up + instantiation; the verdict uses
    // the time measured inside the worker
    const timer = setTimeout(() => { killWorker(); finish({ timedOut: true, wallMs: Math.round(performance.now() - started) }); }, timeLimitMs + 500);
    w.onmessage = (e) => {
      const r = e.data;
      if (!r.ok) { finish(null); return; }
      finish({ ...r, wallMs: Math.round(r.runMs) });
    };
    w.onerror = (ev) => { ev.preventDefault?.(); killWorker(); finish({ wallMs: Math.round(performance.now() - started), trap: ev.message || 'the program crashed', exitCode: 1, memBytes: 0, stdout: '', stderr: '' }); };
    try {
      w.postMessage(module ? { module, input: stdin } : { bytes, input: stdin });
    } catch {
      // WebAssembly.Module isn't cloneable here — send the bytes instead
      try { w.postMessage({ bytes, input: stdin }); } catch { finish(null); }
    }
  });
}

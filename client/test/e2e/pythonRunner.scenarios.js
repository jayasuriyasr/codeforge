// client/test/e2e/pythonRunner.scenarios.js
// ── End-to-end checks for the Python runner, in a real browser ─────────────
// Runs inside a page served by the dev server (it needs Workers, Pyodide and a
// cross-origin-isolated page). Driven by scripts/e2e-python.mjs, or by hand:
//   const s = await import('/test/e2e/pythonRunner.scenarios.js');
//   console.table(await s.runScenarios());
// Each scenario is one behaviour that was measured while designing the runner.

const MB_LIMIT = 256;

const loop = (body) => `while True:\n    ${body}`;
const busyFor = (sec) => `import time\nt = time.perf_counter()\nwhile time.perf_counter() - t < ${sec}:\n    pass\nprint("done")`;

export async function runScenarios({ only } = {}) {
  const py = await import('/src/judge/runners/python.js');
  const results = [];
  const add = (name, pass, detail) => results.push({ name, pass: Boolean(pass), detail });
  const run = (code, input = '', limitMs = 1000, memMb = MB_LIMIT) => py.runPython(code, input, limitMs, memMb);
  const timed = async (fn) => { const t = performance.now(); const r = await fn(); return { r, ms: Math.round(performance.now() - t) }; };
  const want = (name) => !only || only.some((o) => name.includes(o));

  await py.resetPython();
  const info = await py.pythonRuntimeInfo();
  const f = info.factor;
  add('start-up: every feature detected', info.feat.footprint && info.feat.preGrow && info.feat.interrupt && info.snapshotMb > 0,
    `features ${JSON.stringify(info.feat)}, snapshot ${info.snapshotMb.toFixed(1)} MB, warm-up ${Math.round(info.warmMs)} ms, bench ${Math.round(info.benchMs)} ms, factor ${f.toFixed(2)}`);
  add('device factor is between 1 and 3', f >= 1 && f <= 3, `factor ${f.toFixed(2)}`);

  if (want('basic')) {
    let r = await run('n = int(input())\nprint(n * 2)', '21');
    add('basic: stdin → stdout', r.status === 'OK' && r.stdout.trim() === '42', JSON.stringify(r));
    const big = Array.from({ length: 400000 }, (_, i) => i % 1000).join(' ');
    r = await run('import sys\nprint(sum(map(int, sys.stdin.read().split())))', big);
    add('basic: 2.6 MB of input read completely', r.status === 'OK' && r.stdout.trim() === String(400 * 499500), `${big.length} bytes → ${r.stdout.trim()}`);
    r = await run('print(1 // 0)');
    add('basic: runtime error → RE with the message', r.status === 'RE' && /ZeroDivisionError/.test(r.error || ''), (r.error || '').split('\n').pop());
  }

  if (want('TLE')) {
    const L = 1000;
    const cases = [
      ['TLE: while True: pass (interrupt)', loop('pass')],
      ['TLE: program catches every exception', 'while True:\n    try:\n        while True:\n            pass\n    except BaseException:\n        pass'],
      ['TLE: bare except + continue', 'while True:\n    try:\n        x = 0\n        while True:\n            x += 1\n    except:\n        continue'],
      ['TLE: catches, then loops inside a function', 'def spin():\n    while True:\n        pass\nwhile True:\n    try:\n        spin()\n    except BaseException:\n        pass'],
    ];
    for (const [name, code] of cases) {
      const { r, ms } = await timed(() => run(code, '', L));
      const next = await timed(() => run('print(7)', '', L));
      const stopBy = 1.5 * L * f + 150;
      add(name, r.status === 'TLE' && ms <= stopBy && next.r.status === 'OK' && next.ms < 500,
        `verdict ${r.status} after ${ms} ms (stop by ${Math.round(stopBy)}), next program ${next.r.status} in ${next.ms} ms (same Pyodide)`);
    }
    const killed = [
      ['TLE: naive fib(40) (loop-free recursion → terminate)', 'def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\nprint(fib(40))'],
      ['TLE: one long C call sum(range(10**10)) (terminate)', 'print(sum(range(10**10)))'],
      ['TLE: program ignores SIGINT (terminate)', 'import signal\nsignal.signal(signal.SIGINT, signal.SIG_IGN)\n' + loop('pass')],
    ];
    for (const [name, code] of killed) {
      const { r, ms } = await timed(() => run(code, '', L));
      const next = await timed(() => run('print(7)', '', L));
      add(name, r.status === 'TLE' && ms <= 1.5 * L * f + 400 && next.r.status === 'OK',
        `verdict ${r.status} after ${ms} ms, next program ${next.r.status} in ${next.ms} ms (fresh Pyodide from the snapshot)`);
    }
  }

  if (want('borderline')) {
    const L = 1000;
    // slow the first time, fast the second: the re-run's time counts
    const slow = (1.2 * L * f / 1000).toFixed(3), fast = (0.3 * L / 1000).toFixed(3);
    const flaky = `import builtins, time\nn = getattr(builtins, "_cf_runs", 0)\nbuiltins._cf_runs = n + 1\nsec = ${slow} if n % 2 == 0 else ${fast}\nt = time.perf_counter()\nwhile time.perf_counter() - t < sec:\n    pass\nprint("done")`;
    let r = await run('import builtins\nbuiltins._cf_runs = 0');
    r = await run(flaky, '', L);
    add('borderline: slow once, fast on the re-run → OK', r.status === 'OK' && r.wallMs < r.limitMs, `verdict ${r.status}, time ${r.wallMs} ms (limit ${r.limitMs}, first run ~${Math.round(slow * 1000)} ms)`);
    r = await run(busyFor(1.2 * f), '', L);
    add('borderline: slow both times → TLE', r.status === 'TLE', `verdict ${r.status}, time ${r.wallMs} ms (limit ${r.limitMs})`);
  }

  if (want('MLE')) {
    const cases = [
      ['MLE: endless bytearray(1 MB) append', 'a = []\n' + loop('a.append(bytearray(1 << 20))')],
      ['MLE: endless int append', 'a = []\n' + loop('a.append(len(a))')],
      ['MLE: one huge list [0]*10**9', 'x = [0] * 10**9'],
      ['MLE: endless dict insert', 'd = {}\ni = 0\nwhile True:\n    d[i] = i\n    i += 1'],
      ['MLE: program catches the MemoryError', 'try:\n    x = [bytearray(1 << 20) for _ in range(400)]\nexcept MemoryError:\n    x = None\nprint("caught")'],
    ];
    for (const [name, code] of cases) {
      await py.resetPython();
      const { r, ms } = await timed(() => run(code, '', 10000));
      const next = await run('print(7)', '', 1000);
      add(name, r.status === 'MLE' && r.memMb >= MB_LIMIT && r.memMb <= MB_LIMIT + 8 + 1 && next.status === 'OK',
        `verdict ${r.status} after ${ms} ms, reading ${r.memMb.toFixed(1)} MB, next program ${next.status}`);
    }
  }

  if (want('MLE')) {
    // Hits the cap, catches every MemoryError and loops until the interrupt:
    // memory was exceeded first, so MLE (not TLE).
    await py.resetPython();
    const { r, ms } = await timed(() => run('a = []\nwhile True:\n    try:\n        a.append(bytearray(1 << 20))\n    except MemoryError:\n        pass', '', 1000));
    const next = await run('print(7)', '', 1000);
    add('MLE: catches MemoryError and keeps looping → MLE, not TLE', r.status === 'MLE' && next.status === 'OK',
      `verdict ${r.status} after ${ms} ms, next program ${next.status}`);
  }

  if (want('memory')) {
    await py.resetPython();
    let r = await run('a = [bytearray(1 << 20) for _ in range(100)]\nprint(len(a))', '', 5000);
    add('memory: 100 × 1 MB reads about 100 MB', r.status === 'OK' && r.memMb > 98 && r.memMb < 104, `reading ${r.memMb.toFixed(1)} MB`);
    await py.resetPython();
    r = await run('a = bytearray(60 * 2**20)\nprint(len(a))', '', 5000, 64);
    add('memory: 60 MB under a 64 MB limit → OK', r.status === 'OK', `verdict ${r.status}, reading ${r.memMb.toFixed(1)} MB`);
    r = await run('a = bytearray(80 * 2**20)\nprint(len(a))', '', 5000, 64);
    add('memory: 80 MB under a 64 MB limit → MLE', r.status === 'MLE', `verdict ${r.status}, reading ${r.memMb.toFixed(1)} MB`);
  }

  if (want('reused')) {
    // A dict of 1M strings leaves the heap in pieces; a 240 MB block that fits
    // a fresh heap was refused there (a false MLE) — it must be re-checked.
    await py.resetPython();
    let r = await run('d = {i: str(i) for i in range(1_000_000)}\nprint(len(d))', '', 10000);
    const r2 = await run('b = bytearray(240 * 2**20)\nprint(len(b))', '', 10000);
    add('reused heap: false MLE is re-checked on a fresh Pyodide → OK', r.status === 'OK' && r2.status === 'OK',
      `test 1 ${r.status} (${r.memMb.toFixed(0)} MB), test 2 ${r2.status} (${r2.memMb.toFixed(0)} MB)`);
  }

  if (want('speed')) {
    await py.resetPython();
    const first = await run('a = [bytearray(1 << 20) for _ in range(236)]\nprint(len(a))', '', 10000);
    const second = await run('a = [bytearray(1 << 20) for _ in range(236)]\nprint(len(a))', '', 10000);
    add('speed: first big test is pre-grown and pre-touched (close to the 2nd)', first.status === 'OK' && first.wallMs < 2.5 * Math.max(20, second.wallMs),
      `first ${first.wallMs} ms, second ${second.wallMs} ms (pages touched in advance: ${info.touchPages})`);
    const BENCH = 's = 0\nfor i in range(200000):\n    s += (i * i) % 7\nd = {}\nfor i in range(20000):\n    d[i] = i * 2\nx = sorted(d.values(), reverse=True)';
    await py.resetPython();
    const a = await run(BENCH, '', 10000), b = await run(BENCH, '', 10000), c = await run(BENCH, '', 10000);
    add('speed: a restored Pyodide is warm for its first program', a.wallMs <= 1.35 * ((b.wallMs + c.wallMs) / 2),
      `first ${a.wallMs} ms, then ${b.wallMs} / ${c.wallMs} ms`);
    const { r, ms } = await timed(() => run('a = list(range(6_000_000))\nprint(a[-1])', '', 10000));
    add('speed: only the program is timed, not freeing 6 M ints', r.status === 'OK' && r.wallMs < ms - 40,
      `program ${r.wallMs} ms, whole call ${ms} ms (cleanup excluded)`);
  }

  const last = await run('print(sum(range(100)))');
  add('still healthy at the end', last.status === 'OK' && last.stdout.trim() === '4950', JSON.stringify(last));
  return results;
}

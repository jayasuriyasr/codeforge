// client/scripts/calibrate-python.mjs
// ── Calibrate each problem's Python time limit against Pyodide ─────────────
//
// A problem's time limit is chosen for native code. Python in the browser
// (Pyodide) is slower than native CPython — by how much depends on what the
// program does (1.4× for dicts, 3× for plain loops, 9× for big-integer sums
// were measured). So for each problem this measures the slowdown on that
// problem's own workload and gives Python
//
//     python limit = problem limit × (Pyodide time ÷ native CPython time)
//
// capped at MAX_RATIO and rounded up to 0.5 s, stored in
// problems.python_time_limit_sec (null when it is not above the problem limit).
//
// The ratio is measured with the problem's Python reference solution:
//   1. every test case natively (python on this machine, interpreter start-up
//      excluded), with a per-test timeout;
//   2. every test case through the real in-browser runner — outputs must be
//      correct;
//   3. the three slowest native tests (best of 3 ≥ MIN_NATIVE_MS, so timing
//      noise stays small) are repeated 3× on both sides; ratio = the median of
//      their min/min ratios. No test that slow → no change (the limit is then
//      far above what the problem needs, even at 9× slower).
// A slow reference does not inflate the limit: only the ratio is used.
//
//   npm run dev                                   (in another terminal)
//   node scripts/calibrate-python.mjs --refs <dir> [--only 01a,49] [--out f.json] [--resume] [--apply]
//   (--resume keeps the problems already in --out; --apply writes the limits to the database)
//
// <dir> holds one reference per problem: p<id>.py defining solve(input) -> output
// (id = the part after "sn-" in the slug), plus the helper modules they import.
// Needs client/.env.local (database connection), Python 3.12 and Edge/Chrome.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPage } from './lib/cdp.mjs';

const MAX_RATIO = 3;
const MIN_NATIVE_MS = 20;
const NATIVE_TIMEOUT_MS = 15000;

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const refs = arg('--refs');
const url = arg('--url', 'http://localhost:5173/');
const only = (arg('--only', '') || '').split(',').filter(Boolean);
const out = arg('--out', 'python-calibration.json');
const python = arg('--python', process.platform === 'win32' ? 'python' : 'python3');
const apply = process.argv.includes('--apply');
const resume = process.argv.includes('--resume');
if (!refs || !existsSync(refs)) { console.error('Usage: node scripts/calibrate-python.mjs --refs <dir> [--only ids] [--out f] [--apply]'); process.exit(1); }

/** One self-contained program: helper modules embedded, then solve(stdin). */
function bundle(id) {
  if (!existsSync(join(refs, `p${id}.py`))) return null;
  const order = [];
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const src = readFileSync(join(refs, `${name}.py`), 'utf8');
    for (const m of src.matchAll(/^\s*(?:from\s+(\w+)\s+import|import\s+(\w+))/gm)) {
      const dep = m[1] || m[2];
      if (dep !== name && existsSync(join(refs, `${dep}.py`))) visit(dep);
    }
    order.push([name, src]);
  };
  visit(`p${id}`);
  const mainSrc = order.pop()[1];
  return [
    'import sys as _cf_sys, types as _cf_types',
    'def _cf_mod(name, src):',
    '    m = _cf_types.ModuleType(name)',
    '    _cf_sys.modules[name] = m',
    '    exec(compile(src, name + ".py", "exec"), m.__dict__)',
    ...order.map(([name, src]) => `_cf_mod(${JSON.stringify(name)}, ${JSON.stringify(src)})`),
    mainSrc,
    '_cf_sys.stdout.write(str(solve(_cf_sys.stdin.read())) + "\\n")',
  ].join('\n');
}

// Native timing: the program is compiled once, then only its execution is
// timed (same as the browser runner, which excludes Pyodide start-up).
const HARNESS = `import io, sys, time
src = open(sys.argv[1], encoding="utf-8").read()
data = open(sys.argv[2], encoding="utf-8").read()
reps = int(sys.argv[3])
code = compile(src, "<user>", "exec")
best = None
for _ in range(reps):
    sys.stdin = io.StringIO(data)
    sys.stdout = io.StringIO()
    t = time.perf_counter()
    exec(code, {"__name__": "__main__"})
    dt = (time.perf_counter() - t) * 1000
    sys.stdout = sys.__stdout__
    best = dt if best is None else min(best, dt)
print(best)
`;

const work = mkdtempSync(join(tmpdir(), 'cf-calib-'));
writeFileSync(join(work, 'harness.py'), HARNESS);

function nativeMs(programFile, input, reps = 1) {
  const inFile = join(work, 'input.txt');
  writeFileSync(inFile, input);
  const r = spawnSync(python, ['-I', join(work, 'harness.py'), programFile, inFile, String(reps)], { encoding: 'utf8', timeout: NATIVE_TIMEOUT_MS * reps, maxBuffer: 1 << 20 });
  if (r.error || r.status !== 0) return null;   // timed out or crashed
  return Number(r.stdout.trim());
}

// Runs in the page, through the real runner. Indices refer to loadAllTestCases order (= position).
const PAGE_FN = `async (slug, program, checkIdx, timeIdx) => {
  const P = await import('/src/lib/problems.js');
  const C = await import('/src/judge/checker.js');
  const py = await import('/src/judge/runners/python.js');
  let p;
  for (let k = 0; k < 4 && !p; k++) { try { p = await P.loadProblem(slug); } catch (e) { await new Promise((r) => setTimeout(r, 1500)); } }
  const cases = await P.loadAllTestCases(p);
  const ms = {};
  const bad = [];
  let correct = 0;
  for (const i of checkIdx) {
    const tc = cases[i];
    const r = await py.runPython(program, tc.input, 60000, p.memoryLimitMB);
    const ok = r.status === 'OK' && (C.check(p.checkerType, r.stdout, tc.expectedOutput, tc.input)
      || String(r.stdout).trim() === String(tc.expectedOutput).trim());
    if (ok) correct++; else if (bad.length < 5) bad.push({ test: i, status: r.status, error: (r.error || '').split('\\n').pop() });
    ms[i] = r.wallMs;
  }
  for (const i of timeIdx) {
    for (let k = 0; k < 2; k++) {
      const r = await py.runPython(program, cases[i].input, 60000, p.memoryLimitMB);
      if (r.status === 'OK') ms[i] = Math.min(ms[i], r.wallMs);
    }
  }
  const info = await py.pythonRuntimeInfo();
  return { correct, bad, ms, benchMs: info.benchMs };
}`;

let db = null;
const { connect } = await import('../../scripts/db-setup.mjs');
db = await connect();
const page = await openPage(url);
const results = resume && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
const done = new Set(results.map((r) => r.slug));
try {
  const { rows: problems } = await db.query(
    "select id, slug, time_limit_sec, memory_limit_mb from public.problems where slug like 'sn-%' and published order by slug");
  const targets = problems
    .map((p) => ({ ...p, pid: (p.slug.match(/^sn-([0-9]+[a-z]?)-/) || [])[1] }))
    .filter((t) => t.pid && (!only.length || only.includes(t.pid)));
  console.log(`${targets.length} problems`);
  for (const t of targets) {
    if (done.has(t.slug)) continue;
    const program = bundle(t.pid);
    if (!program) { console.log(`- ${t.pid.padEnd(4)} no Python reference, skipped`); continue; }
    const programFile = join(work, `p${t.pid}.py`);
    writeFileSync(programFile, program);
    const { rows: cases } = await db.query('select position, input from public.test_cases where problem_id = $1 order by position', [t.id]);
    const limitMs = Number(t.time_limit_sec) * 1000;

    // 1. native, every test
    const native = cases.map((c) => nativeMs(programFile, c.input));
    const usable = native.map((ms, i) => ({ i, ms })).filter((x) => x.ms != null);
    // A first run includes one-time costs (imports, caches): choose by the best of 3.
    const candidates = usable.filter((x) => x.ms <= limitMs / 2).sort((a, b) => b.ms - a.ms).slice(0, 6);
    for (const x of candidates) x.ms = nativeMs(programFile, cases[x.i].input, 3) ?? x.ms;
    const timeSet = candidates.filter((x) => x.ms >= MIN_NATIVE_MS).sort((a, b) => b.ms - a.ms).slice(0, 3);

    // 2 + 3. the browser runner: correctness on every test that ran natively, timing on timeSet
    const r = await page.evaluate(`(${PAGE_FN})(${JSON.stringify(t.slug)}, ${JSON.stringify(program)}, ${JSON.stringify(usable.map((x) => x.i))}, ${JSON.stringify(timeSet.map((x) => x.i))})`, 60 * 60 * 1000);
    const ratios = timeSet.map((x) => ({ test: x.i, nativeMs: +x.ms.toFixed(1), pyodideMs: r.ms[x.i], ratio: +(r.ms[x.i] / x.ms).toFixed(2) }));
    const sorted = ratios.map((x) => x.ratio).sort((a, b) => a - b);
    const ratio = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;   // median (lower)
    const limitSec = Number(t.time_limit_sec);
    const pythonLimitSec = ratio ? Math.ceil((limitSec * Math.min(MAX_RATIO, Math.max(1, ratio))) * 2) / 2 : limitSec;
    const res = {
      slug: t.slug, pid: t.pid, cases: cases.length, nativeTimeouts: cases.length - usable.length, correct: r.correct, checked: usable.length,
      bad: r.bad, limitSec, ratio, ratios, pythonLimitSec, store: pythonLimitSec > limitSec ? pythonLimitSec : null, benchMs: r.benchMs,
    };
    results.push(res);
    const okMark = res.correct === res.checked ? '✓' : '✗';
    console.log(`${okMark} ${t.pid.padEnd(4)} ${String(res.correct).padStart(4)}/${String(res.checked).padEnd(4)} ratio ${ratio == null ? '  - ' : ratio.toFixed(2)}  → python ${pythonLimitSec}s${res.store ? ' (raised)' : ''}${res.nativeTimeouts ? `  [${res.nativeTimeouts} test(s) too slow natively, not used]` : ''}${res.bad.length ? '  ' + JSON.stringify(res.bad) : ''}`);
    writeFileSync(out, JSON.stringify(results, null, 2));
  }
} finally {
  await page.close();
}

const broken = results.filter((r) => r.correct !== r.checked);
console.log(`\n${results.length} calibrated, ${results.filter((r) => r.store).length} raised, ${broken.length} with wrong outputs → ${out}`);
try {
  if (apply) {
    if (broken.length) { console.error('Not applying: some references gave wrong outputs in the browser.'); process.exitCode = 1; }
    else {
      for (const r of results) await db.query('update public.problems set python_time_limit_sec = $1 where slug = $2', [r.store, r.slug]);
      console.log(`Applied ${results.length} limits to the database.`);
    }
  }
} finally {
  await db.end();
}

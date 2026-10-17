'use strict';

// ── Acceptance test — Phase 3C language handlers ─────────────────────────────
// No container, no Docker. Verifies command shapes and content only.

const cpp = require('./src/judge/languages/cpp');
const py  = require('./src/judge/languages/python');
const js  = require('./src/judge/languages/javascript');

let passed = 0, failed = 0;

function assert(label, fn) {
  try   { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.message}`); failed++; }
}

const W = '/workspace';

// ── C handler ─────────────────────────────────────────────────────────────────
console.log('\n── C handler ────────────────────────────────────────────────────');
{
  const { compileCmd, runCmd } = cpp.getCommands('c');

  assert('compileCmd uses gcc (not g++)', () => {
    if (!compileCmd.startsWith('gcc ')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd contains source file solution.c', () => {
    if (!compileCmd.includes('solution.c')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd outputs to /workspace/a.out', () => {
    if (!compileCmd.includes(`-o ${W}/a.out`)) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd has -O2', () => {
    if (!compileCmd.includes('-O2')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd links -lm', () => {
    if (!compileCmd.includes('-lm')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('runCmd is /workspace/a.out', () => {
    if (runCmd !== `${W}/a.out`) throw new Error(`Got: ${runCmd}`);
  });
  assert('sourceFileName is solution.c', () => {
    if (cpp.sourceFileName('c') !== 'solution.c') throw new Error(`Got: ${cpp.sourceFileName('c')}`);
  });
}

// ── C++ handler ───────────────────────────────────────────────────────────────
console.log('\n── C++ handler ──────────────────────────────────────────────────');
{
  const { compileCmd, runCmd } = cpp.getCommands('cpp');

  assert('compileCmd uses g++ (not gcc)', () => {
    if (!compileCmd.startsWith('g++ ')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd contains source file solution.cpp', () => {
    if (!compileCmd.includes('solution.cpp')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd outputs to /workspace/a.out', () => {
    if (!compileCmd.includes(`-o ${W}/a.out`)) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd has -O2', () => {
    if (!compileCmd.includes('-O2')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd has -std=c++17', () => {
    if (!compileCmd.includes('-std=c++17')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('compileCmd links -lm', () => {
    if (!compileCmd.includes('-lm')) throw new Error(`Got: ${compileCmd}`);
  });
  assert('runCmd is /workspace/a.out', () => {
    if (runCmd !== `${W}/a.out`) throw new Error(`Got: ${runCmd}`);
  });
  assert('sourceFileName is solution.cpp', () => {
    if (cpp.sourceFileName('cpp') !== 'solution.cpp') throw new Error(`Got: ${cpp.sourceFileName('cpp')}`);
  });
  assert('unknown language throws', () => {
    try { cpp.getCommands('java'); throw new Error('expected throw'); }
    catch (e) { if (e.message === 'expected throw') throw e; }
  });
}

// ── Python handler ────────────────────────────────────────────────────────────
console.log('\n── Python handler ───────────────────────────────────────────────');
{
  const { compileCmd, runCmd } = py.getCommands();

  assert('compileCmd is null (no compile step)', () => {
    if (compileCmd !== null) throw new Error(`Expected null, got: ${compileCmd}`);
  });
  assert('runCmd starts with python3', () => {
    if (!runCmd.startsWith('python3 ')) throw new Error(`Got: ${runCmd}`);
  });
  assert('runCmd targets /workspace/solution.py', () => {
    if (!runCmd.includes(`${W}/solution.py`)) throw new Error(`Got: ${runCmd}`);
  });
  assert('sourceFileName is solution.py', () => {
    if (py.sourceFileName() !== 'solution.py') throw new Error(`Got: ${py.sourceFileName()}`);
  });
}

// ── JavaScript handler ────────────────────────────────────────────────────────
console.log('\n── JavaScript handler ───────────────────────────────────────────');
{
  const { compileCmd, runCmd } = js.getCommands();

  assert('compileCmd is null (no compile step)', () => {
    if (compileCmd !== null) throw new Error(`Expected null, got: ${compileCmd}`);
  });
  assert('runCmd starts with node', () => {
    if (!runCmd.startsWith('node ')) throw new Error(`Got: ${runCmd}`);
  });
  assert('runCmd targets /workspace/solution.js', () => {
    if (!runCmd.includes(`${W}/solution.js`)) throw new Error(`Got: ${runCmd}`);
  });
  assert('sourceFileName is solution.js', () => {
    if (js.sourceFileName() !== 'solution.js') throw new Error(`Got: ${js.sourceFileName()}`);
  });
}

// ── Consistent shape across all handlers ─────────────────────────────────────
console.log('\n── Consistent handler shape (Runner contract) ───────────────────');
{
  const handlers = [
    { name: 'cpp(c)',  h: cpp.getCommands('c')   },
    { name: 'cpp(cpp)',h: cpp.getCommands('cpp') },
    { name: 'python',  h: py.getCommands()       },
    { name: 'js',      h: js.getCommands()       },
  ];

  for (const { name, h } of handlers) {
    assert(`${name}: has compileCmd key (string or null)`, () => {
      if (!('compileCmd' in h)) throw new Error('missing compileCmd');
      if (h.compileCmd !== null && typeof h.compileCmd !== 'string')
        throw new Error(`compileCmd type: ${typeof h.compileCmd}`);
    });
    assert(`${name}: has runCmd key (non-empty string)`, () => {
      if (typeof h.runCmd !== 'string' || h.runCmd.length === 0)
        throw new Error(`runCmd = "${h.runCmd}"`);
    });
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
if (failed > 0) process.exit(1);

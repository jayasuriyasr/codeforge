'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const cpp = require('../../src/judge/languages/cpp');
const py = require('../../src/judge/languages/python');
const js = require('../../src/judge/languages/javascript');

test('C: gcc compile to /workspace/a.out, run the binary', () => {
  const { compileCmd, runCmd } = cpp.getCommands('c');
  assert.match(compileCmd, /^gcc /);
  assert.match(compileCmd, /-O2/);
  assert.match(compileCmd, /-o \/workspace\/a\.out/);
  assert.match(compileCmd, /solution\.c/);
  assert.equal(runCmd, '/workspace/a.out');
  assert.equal(cpp.sourceFileName('c'), 'solution.c');
});

test('C++: g++ with -std=c++17', () => {
  const { compileCmd } = cpp.getCommands('cpp');
  assert.match(compileCmd, /^g\+\+ /);
  assert.match(compileCmd, /-std=c\+\+17/);
  assert.equal(cpp.sourceFileName('cpp'), 'solution.cpp');
});

test('C++ handler rejects an unknown language', () => {
  assert.throws(() => cpp.getCommands('rust'));
});

test('Python: no compile step, runs python3', () => {
  const { compileCmd, runCmd } = py.getCommands();
  assert.equal(compileCmd, null);
  assert.match(runCmd, /^python3 \/workspace\/solution\.py/);
  assert.equal(py.sourceFileName(), 'solution.py');
});

test('JavaScript: no compile step, runs node', () => {
  const { compileCmd, runCmd } = js.getCommands();
  assert.equal(compileCmd, null);
  assert.match(runCmd, /^node \/workspace\/solution\.js/);
  assert.equal(js.sourceFileName(), 'solution.js');
});

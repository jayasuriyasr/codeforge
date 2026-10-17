'use strict';

// ── Phase 2 execution-engine integration matrix ────────────────────────────
//
// Needs: Docker (with the codeforge/fat-judge image built), MongoDB, Redis.
//   docker compose up -d --build
//   npm run test:integration
//
// Drives judge/sandbox.js + judge/supervisor.py + judge/verdict.js end to end by
// calling worker.judge() directly (no queue) for deterministic assertions.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const mongoose = require('mongoose');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge_itest';

let dockerOk = false;
try { execFileSync('docker', ['ps'], { stdio: 'ignore' }); dockerOk = true; } catch { /* no daemon */ }

const Problem = require('../../src/models/Problem');
const { judge } = require('../../src/queue/worker');
const { reapOrphans } = require('../../src/judge/sandbox');

const TL = 2;          // seconds
const ML = 128;        // MB

function mkProblem(testCases, over = {}) {
  return new Problem({
    title: 't', slug: `it-${Math.random().toString(36).slice(2)}`, statement: 's',
    mode: 'practice', timeLimitSec: TL, memoryLimitMB: ML, checkerType: 'exact',
    testCases, ...over,
  }).toObject();
}
const sub = (language, code) => ({ _id: `it-${Math.random().toString(36).slice(2)}`, language, code });

// Stub the status writes judge() makes.
const Submission = require('../../src/models/Submission');
before(async () => {
  if (!dockerOk) return;
  Submission.findByIdAndUpdate = async () => ({});
  await mongoose.connect(process.env.MONGO_URI);
  await reapOrphans();
});
after(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
  await reapOrphans().catch(() => {});
});

const maybe = dockerOk ? test : test.skip;

maybe('C++ correct → AC with per-case results', async () => {
  const p = mkProblem([
    { input: '2 3\n', expectedOutput: '5' },
    { input: '10 20\n', expectedOutput: '30' },
  ]);
  const code = '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}';
  const r = await judge(sub('cpp', code), p);
  assert.equal(r.verdict, 'AC');
  assert.equal(r.testResults.length, 2);
  assert.ok(r.runtimeMs >= 0 && r.runtimeMs < TL * 1000);
  assert.ok(r.memoryMB > 0 && r.memoryMB < ML);
});

maybe('C++ wrong answer → WA, failing case revealed (practice)', async () => {
  const p = mkProblem([{ input: '2 3\n', expectedOutput: '5' }]);
  const r = await judge(sub('cpp', '#include <iostream>\nint main(){std::cout<<42;}'), p);
  assert.equal(r.verdict, 'WA');
  assert.equal(r.failedTestCase.expectedOutput, '5');
  assert.equal(r.failedTestCase.actualOutput.trim(), '42');
});

maybe('Python infinite loop → TLE (not RE, not MLE)', async () => {
  const p = mkProblem([{ input: '', expectedOutput: 'x' }]);
  const r = await judge(sub('python', 'while True: pass'), p);
  assert.equal(r.verdict, 'TLE');
  assert.ok(r.testResults[0].runtimeMs >= TL * 1000 - 200);
});

maybe('C++ over the memory limit → MLE (not TLE)', async () => {
  const p = mkProblem([{ input: '', expectedOutput: 'x' }]);
  // ~400 MB, limit is 128 MB
  const code = '#include <cstring>\n#include <cstdlib>\nint main(){size_t n=400ull<<20;char*p=(char*)malloc(n);for(size_t i=0;i<n;i+=4096)p[i]=1;volatile char s=p[0];(void)s;return 0;}';
  const r = await judge(sub('cpp', code), p);
  assert.equal(r.verdict, 'MLE');
});

maybe('C++ compile error → CE with compiler output', async () => {
  const p = mkProblem([{ input: '', expectedOutput: 'x' }]);
  const r = await judge(sub('cpp', 'int main() { this is not c++ }'), p);
  assert.equal(r.verdict, 'CE');
  assert.ok(r.compileError && r.compileError.length > 0);
});

maybe('Python runtime error → RE', async () => {
  const p = mkProblem([{ input: '', expectedOutput: 'x' }]);
  const r = await judge(sub('python', 'raise SystemExit(3)'), p);
  assert.equal(r.verdict, 'RE');
});

maybe('Java with a text block → AC, no false MLE near the limit', async () => {
  const p = mkProblem([{ input: '', expectedOutput: 'hello' }], { memoryLimitMB: 256 });
  const code = [
    'public class Main {',
    '  public static void main(String[] a) {',
    '    String s = """',
    'hello""";',
    '    System.out.println(s);',
    '  }',
    '}',
  ].join('\n');
  const r = await judge(sub('java', code), { ...p, memoryLimitMB: 256 });
  assert.equal(r.verdict, 'AC');
});

maybe('all four interpreted/compiled languages agree on a sum problem', async () => {
  const p = mkProblem([{ input: '7 8\n', expectedOutput: '15' }]);
  const progs = {
    c: '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);}',
    javascript: 'const [a,b]=require("fs").readFileSync(0,"utf8").split(/\\s+/).map(Number);console.log(a+b);',
  };
  for (const [lang, code] of Object.entries(progs)) {
    const r = await judge(sub(lang, code), p);
    assert.equal(r.verdict, 'AC', `${lang} should AC`);
  }
});

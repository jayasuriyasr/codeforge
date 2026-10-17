'use strict';

// ── Acceptance tests — Phase 3D checkers + testRunner ────────────────────────

const { defaultChecker, norm }       = require('./src/judge/checkers/exact');
const { floatChecker }               = require('./src/judge/checkers/float');
const { specialChecker, SpecialCheckerNotImplementedError } = require('./src/judge/checkers/special');
const { runChecks }                  = require('./src/judge/testRunner');

let passed = 0, failed = 0;

function assert(label, fn) {
  try   { fn(); console.log(`  ✅  ${label}`); passed++; }
  catch (e) { console.error(`  ❌  ${label}\n       ${e.message}`); failed++; }
}
function assertThrows(label, fn, klass) {
  try {
    fn();
    console.error(`  ❌  ${label} — expected throw`); failed++;
  } catch (e) {
    if (klass && !(e instanceof klass)) {
      console.error(`  ❌  ${label} — wrong error type: ${e.constructor.name}`); failed++;
    } else { console.log(`  ✅  ${label}`); passed++; }
  }
}

// ── exact checker — defaultChecker verbatim from §7 ──────────────────────────
console.log('\n── exact checker (defaultChecker) ───────────────────────────────');

assert('identical strings → true', () => {
  if (!defaultChecker('hello\n', 'hello\n')) throw new Error();
});
assert('trailing newline ignored → true', () => {
  if (!defaultChecker('hello\n', 'hello')) throw new Error();
});
assert('trailing spaces per line ignored → true', () => {
  if (!defaultChecker('hello   \nworld  \n', 'hello\nworld')) throw new Error();
});
assert('trailing tabs ignored → true', () => {
  if (!defaultChecker('1\t\n2\t', '1\n2')) throw new Error();
});
assert('multiple trailing blank lines ignored → true', () => {
  if (!defaultChecker('42\n\n\n', '42')) throw new Error();
});
assert('interior blank line is significant → true', () => {
  if (!defaultChecker('a\n\nb', 'a\n\nb')) throw new Error();
});
assert('interior blank line vs no blank line → false (WA)', () => {
  if (defaultChecker('a\n\nb', 'a\nb')) throw new Error('should be WA');
});
assert('case difference → false (WA)', () => {
  if (defaultChecker('Hello', 'hello')) throw new Error('should be WA');
});
assert('extra space within line → false (WA)', () => {
  if (defaultChecker('1  2', '1 2')) throw new Error('should be WA');
});
assert('completely different → false (WA)', () => {
  if (defaultChecker('abc', 'xyz')) throw new Error('should be WA');
});
assert('empty vs empty → true', () => {
  if (!defaultChecker('', '')) throw new Error();
});
assert('empty vs whitespace-only → true (both normalise to empty)', () => {
  if (!defaultChecker('  \n\n  \n', '')) throw new Error();
});

// ── float checker ─────────────────────────────────────────────────────────────
console.log('\n── float checker ────────────────────────────────────────────────');

assert('exact float match → accepted', () => {
  if (!floatChecker('3.14159', '3.14159').accepted) throw new Error();
});
assert('within absolute epsilon → accepted', () => {
  // diff = 1e-10 < absEps(1e-9)
  if (!floatChecker('1.0000000001', '1.0').accepted) throw new Error();
});
assert('within relative epsilon → accepted', () => {
  // expected=1000, diff=0.0001 < relEps(1e-6)*1000 = 0.001
  if (!floatChecker('1000.0001', '1000').accepted) throw new Error();
});
assert('beyond epsilon → rejected', () => {
  if (floatChecker('1.1', '1.0').accepted) throw new Error('should reject');
});
assert('token count mismatch → rejected', () => {
  if (floatChecker('1.0 2.0', '1.0').accepted) throw new Error('should reject');
});
assert('non-numeric token exact match → accepted', () => {
  if (!floatChecker('YES', 'YES').accepted) throw new Error();
});
assert('non-numeric token mismatch → rejected', () => {
  if (floatChecker('YES', 'NO').accepted) throw new Error('should reject');
});
assert('multi-token mixed → accepted', () => {
  if (!floatChecker('3.14159265 YES 42', '3.14159265 YES 42').accepted) throw new Error();
});
assert('floatChecker returns message on failure', () => {
  const r = floatChecker('2.0', '1.0');
  if (!r.message) throw new Error('no message on failure');
});

// ── special checker stub ───────────────────────────────────────────────────────
console.log('\n── special checker (stub) ───────────────────────────────────────');

assertThrows(
  'specialChecker always throws SpecialCheckerNotImplementedError',
  () => specialChecker('input', 'actual', 'expected'),
  SpecialCheckerNotImplementedError
);

assert('SpecialCheckerNotImplementedError has status 501', () => {
  try { specialChecker('i', 'a', 'e'); }
  catch (e) { if (e.status !== 501) throw new Error(`status=${e.status}`); }
});

// ── testRunner — dispatch and short-circuit ────────────────────────────────────
console.log('\n── testRunner (runChecks) ───────────────────────────────────────');

const mkProblem = (checkerType, testCases) => ({ checkerType, testCases });

const tcExact = [
  { input: '1', expectedOutput: 'hello' },
  { input: '2', expectedOutput: 'world' },
  { input: '3', expectedOutput: 'foo'   },
];

assert('all passing → AC, checkedCount = N', () => {
  const r = runChecks(mkProblem('exact', tcExact), ['hello', 'world', 'foo']);
  if (r.verdict !== 'AC')            throw new Error(`verdict=${r.verdict}`);
  if (r.checkedCount !== 3)          throw new Error(`checkedCount=${r.checkedCount}`);
  if (r.failedIndex !== null)        throw new Error(`failedIndex=${r.failedIndex}`);
});

assert('first case fails → WA, failedIndex=0, checkedCount=1 (short-circuit)', () => {
  const r = runChecks(mkProblem('exact', tcExact), ['WRONG', 'world', 'foo']);
  if (r.verdict !== 'WA')   throw new Error(`verdict=${r.verdict}`);
  if (r.failedIndex !== 0)  throw new Error(`failedIndex=${r.failedIndex}`);
  if (r.checkedCount !== 1) throw new Error(`checkedCount=${r.checkedCount}`);
});

assert('second case fails → WA, failedIndex=1, checkedCount=2 (short-circuit)', () => {
  const r = runChecks(mkProblem('exact', tcExact), ['hello', 'WRONG', 'foo']);
  if (r.verdict !== 'WA')   throw new Error(`verdict=${r.verdict}`);
  if (r.failedIndex !== 1)  throw new Error(`failedIndex=${r.failedIndex}`);
  if (r.checkedCount !== 2) throw new Error(`checkedCount=${r.checkedCount} (should stop at 2)`);
});

assert('trailing-whitespace difference ignored by exact → AC', () => {
  const r = runChecks(mkProblem('exact', tcExact), ['hello   ', 'world\t', 'foo\n']);
  if (r.verdict !== 'AC') throw new Error(`verdict=${r.verdict}`);
});

assert('float checkerType dispatched correctly → AC', () => {
  const tc = [{ input: '', expectedOutput: '3.14159' }];
  const r  = runChecks(mkProblem('float', tc), ['3.14159']);
  if (r.verdict !== 'AC') throw new Error(`verdict=${r.verdict}`);
});

assert('float WA dispatched correctly', () => {
  const tc = [{ input: '', expectedOutput: '1.0' }];
  const r  = runChecks(mkProblem('float', tc), ['2.0']);
  if (r.verdict !== 'WA') throw new Error(`verdict=${r.verdict}`);
});

assert('special checkerType → INFRA_ERROR (stub)', () => {
  const tc = [{ input: '', expectedOutput: '42' }];
  const r  = runChecks(mkProblem('special', tc), ['42']);
  if (r.verdict !== 'INFRA_ERROR') throw new Error(`verdict=${r.verdict}`);
});

assert('unknown checkerType → INFRA_ERROR', () => {
  const tc = [{ input: '', expectedOutput: '1' }];
  const r  = runChecks({ checkerType: 'banana', testCases: tc }, ['1']);
  if (r.verdict !== 'INFRA_ERROR') throw new Error(`verdict=${r.verdict}`);
});

assert('empty test cases → AC, checkedCount=0', () => {
  const r = runChecks(mkProblem('exact', []), []);
  if (r.verdict !== 'AC')   throw new Error(`verdict=${r.verdict}`);
  if (r.checkedCount !== 0) throw new Error(`checkedCount=${r.checkedCount}`);
});

assert('actualOutputs length mismatch → INFRA_ERROR', () => {
  const r = runChecks(mkProblem('exact', tcExact), ['hello', 'world']);
  if (r.verdict !== 'INFRA_ERROR') throw new Error(`verdict=${r.verdict}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────────────`);
if (failed > 0) process.exit(1);

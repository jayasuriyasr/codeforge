import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactChecker, floatChecker, tokensChecker, strictChecker, check07, check10, check, norm } from '../src/judge/checker.js';

// These MUST match server/src/judge/checkers — the client practice verdict and
// the server verdict have to mean the same thing.

test('exact: trailing whitespace / newlines / CRLF ignored', () => {
  assert.equal(exactChecker('hi \t\r\n\r\n', 'hi'), true);
  assert.equal(norm('a\r\nb\r'), 'a\nb');
});

test('exact: interior differences are WA', () => {
  assert.equal(exactChecker('a  b', 'a b'), false);
});

test('float: within epsilon accepted, beyond rejected', () => {
  assert.equal(floatChecker('1.0000001 2', '1 2'), true);
  assert.equal(floatChecker('1.5 2', '1 2'), false);
});

test('float: token count mismatch rejected', () => {
  assert.equal(floatChecker('1 2 3', '1 2'), false);
});

test('check() dispatches on checkerType', () => {
  assert.equal(check('float', '2.0000001', '2.0'), true);
  assert.equal(check('exact', '2.0000001', '2.0'), false);
  assert.equal(check('tokens', '1\n2', '1 2'), true);
  assert.equal(check('check10', '1 3', '1 3', '3 4\n1 2 3'), true);
});

test('tokens: spacing and line breaks ignored, values and count are not', () => {
  assert.equal(tokensChecker('1   2\n3\n', '1 2 3'), true);
  assert.equal(tokensChecker('1 2', '1 2 3'), false);
  assert.equal(tokensChecker('1 2 4', '1 2 3'), false);
});

test('strict: every space counts, only CRLF and one final newline forgiven', () => {
  assert.equal(strictChecker('  that  \r\n', '  that  \n'), true);
  assert.equal(strictChecker('  that', '  that  '), false);
  assert.equal(strictChecker('a\n\n', 'a\n'), false);
});

test('check07: every pick a candidate, picks spread evenly', () => {
  const input = '4 6\n7 1 7 7';                    // value 7 at indices 0, 2, 3
  assert.equal(check07('0 2 3 0 2 3', 'CANDIDATES 0 2 3', input), true);
  assert.equal(check07('0 2 1 0 2 3', 'CANDIDATES 0 2 3', input), false);   // 1 holds the wrong value
  assert.equal(check07('0 2 3', 'CANDIDATES 0 2 3', input), false);         // too few picks
  const many = '3 3000\n5 5 5';
  assert.equal(check07(Array(3000).fill(0).join(' '), 'CANDIDATES 0 1 2', many), false);  // never random
  assert.equal(check07(Array.from({ length: 3000 }, (_, i) => i % 3).join(' '), 'CANDIDATES 0 1 2', many), true);
});

test('check10: any pair at two different indices with the best |a + b - x|', () => {
  const input = '4 10\n1 4 6 9';
  assert.equal(check10('4 6', '1 9', input), true);   // also exactly 10
  assert.equal(check10('6 4', '1 9', input), true);   // order doesn't matter
  assert.equal(check10('1 4', '1 9', input), false);  // worse pair
  assert.equal(check10('6 6', '1 9', input), false);  // 6 appears only once
  assert.equal(check10('5 5', '1 9', input), false);  // not in the array
});

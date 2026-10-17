import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactChecker, floatChecker, check, norm } from '../src/judge/checker.js';

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
});

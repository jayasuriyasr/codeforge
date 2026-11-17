import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MB, SLACK_MB, CLEAN_MB, GRACE, MAX_GRACE_MS, REF_BENCH_MS, MAX_DEVICE_FACTOR,
  deviceFactor, timeLimitSecFor, capHeapBytes, decide, stopAtMs,
} from '../src/judge/runners/pyPolicy.js';
import { judgePractice } from '../src/judge/index.js';

// ── device factor ─────────────────────────────────────────────────────────
test('device factor: never below 1, never above the cap', () => {
  assert.equal(deviceFactor(REF_BENCH_MS / 2), 1);           // faster than the reference → no less time
  assert.equal(deviceFactor(REF_BENCH_MS), 1);
  assert.equal(deviceFactor(REF_BENCH_MS * 2), 2);
  assert.equal(deviceFactor(REF_BENCH_MS * 10), MAX_DEVICE_FACTOR);
});

test('device factor: missing or bad measurement → 1', () => {
  for (const v of [0, -5, NaN, undefined, null]) assert.equal(deviceFactor(v), 1);
});

// ── per-language time limit ───────────────────────────────────────────────
test('python uses the calibrated limit when it is larger', () => {
  assert.equal(timeLimitSecFor('python', { timeLimitSec: 5, pythonTimeLimitSec: 9.5 }), 9.5);
  assert.equal(timeLimitSecFor('python', { timeLimitSec: 5, pythonTimeLimitSec: 3 }), 5);   // never stricter
  assert.equal(timeLimitSecFor('python', { timeLimitSec: 5, pythonTimeLimitSec: null }), 5);
  assert.equal(timeLimitSecFor('python', { timeLimitSec: 5 }), 5);
});

test('other languages ignore the python limit', () => {
  for (const lang of ['javascript', 'cpp', 'c', 'java']) {
    assert.equal(timeLimitSecFor(lang, { timeLimitSec: 2, pythonTimeLimitSec: 8 }), 2);
  }
});

test('missing time limit falls back to 2 s', () => {
  assert.equal(timeLimitSecFor('python', {}), 2);
  assert.equal(timeLimitSecFor('cpp', { timeLimitSec: 0 }), 2);
});

// ── heap cap ──────────────────────────────────────────────────────────────
test('cap = heap top + limit + slack, rounded up to whole 64 KiB pages', () => {
  const top = 20 * MB + 123;
  const cap = capHeapBytes(top, 256);
  assert.equal(cap % 65536, 0);
  assert.ok(cap >= top + (256 + SLACK_MB) * MB);
  assert.ok(cap - (top + (256 + SLACK_MB) * MB) < 65536);
  assert.equal(capHeapBytes(top, Infinity), Infinity);
});

// ── verdict decisions ─────────────────────────────────────────────────────
const ok = (over = {}) => ({ ok: true, runMs: 100, memMb: 10, startMb: 0, ...over });
const L = { limitMs: 1000, memLimitMb: 256 };

test('finished within the limit → OK', () => {
  assert.equal(decide(ok({ runMs: 1000 }), L), 'OK');
});

test('finished between 1× and 1.5× → one more run, then TLE', () => {
  assert.equal(decide(ok({ runMs: 1001 }), L), 'RERUN');
  assert.equal(decide(ok({ runMs: GRACE * 1000 }), L), 'RERUN');
  assert.equal(decide(ok({ runMs: 1200 }), { ...L, rerun: true }), 'TLE');
  assert.equal(decide(ok({ runMs: 900 }), { ...L, rerun: true }), 'OK');
});

test('interrupt point: 1.5× the limit, at most 3 s past it', () => {
  assert.equal(stopAtMs(1000), 1500);
  assert.equal(stopAtMs(6000), 6000 + MAX_GRACE_MS);
  assert.equal(stopAtMs(15000), 18000);
  assert.equal(decide(ok({ runMs: 17500 }), { limitMs: 15000, memLimitMb: 256 }), 'RERUN');
  assert.equal(decide(ok({ runMs: 18500 }), { limitMs: 15000, memLimitMb: 256 }), 'TLE');
});

test('past 1.5× (no interrupt available) → TLE without a re-run', () => {
  assert.equal(decide(ok({ runMs: GRACE * 1000 + 1 }), L), 'TLE');
});

test('interrupted or terminated → TLE, whatever else happened', () => {
  assert.equal(decide({ ...ok(), interrupted: true }, L), 'TLE');
  assert.equal(decide({ killed: true, ok: false, runMs: 1700, memMb: 0, startMb: 0 }, L), 'TLE');
  assert.equal(decide({ ...ok(), interrupted: true, refused: true }, L), 'TLE');
});

test('refused growth on a clean heap → MLE, even if the program caught it', () => {
  assert.equal(decide(ok({ refused: true, startMb: 0 }), L), 'MLE');
  assert.equal(decide(ok({ refused: true, startMb: CLEAN_MB }), L), 'MLE');
  assert.equal(decide({ ok: false, oom: true, runMs: 50, memMb: 250, startMb: 1 }, L), 'MLE');
});

test('refused growth on a reused heap → re-check on a fresh Pyodide', () => {
  assert.equal(decide(ok({ refused: true, startMb: CLEAN_MB + 1 }), L), 'RECHECK');
  assert.equal(decide(ok({ refused: true, startMb: 200 }), { ...L, recheck: true }), 'MLE');
});

test('memory reading over limit + slack → MLE', () => {
  assert.equal(decide(ok({ memMb: 256 + SLACK_MB }), L), 'OK');
  assert.equal(decide(ok({ memMb: 256 + SLACK_MB + 0.5 }), L), 'MLE');
  assert.equal(decide(ok({ memMb: 5000 }), { limitMs: 1000, memLimitMb: Infinity }), 'OK');
});

test('any other error → RE', () => {
  assert.equal(decide({ ok: false, error: 'ZeroDivisionError', runMs: 3, memMb: 0, startMb: 0 }, L), 'RE');
});

// ── judgePractice passes the Python limit to the runner ───────────────────
test('judgePractice gives python its calibrated limit, other languages the base', async () => {
  const seen = [];
  const runner = async (code, input, limitMs) => { seen.push(limitMs); return { status: 'OK', wallMs: 1, memMb: 1, stdout: 'a' }; };
  const problem = { checkerType: 'exact', timeLimitSec: 5, pythonTimeLimitSec: 9.5, memoryLimitMB: 64, testCases: [{ input: '', expectedOutput: 'a' }] };
  await judgePractice({ language: 'python', code: '', problem, runner });
  await judgePractice({ language: 'javascript', code: '', problem, runner });
  assert.deepEqual(seen, [9500, 5000]);
});

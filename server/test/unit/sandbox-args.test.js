'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { HARDENING_ARGS, NAME_PREFIX } = require('../../src/judge/sandbox');

test('hardening flags: the sandbox is locked down', () => {
  const a = HARDENING_ARGS.join(' ');
  assert.match(a, /--network=none/);
  assert.match(a, /--cap-drop=ALL/);
  assert.match(a, /--security-opt=no-new-privileges/);
  assert.match(a, /--read-only/);
  assert.match(a, /--pids-limit=\d+/);
  assert.match(a, /--user 1000:1000/);
  assert.match(a, /--memory=\d+m/);
  assert.match(a, /--memory-swap=\d+m/);
});

test('hardening flags: /dev/shm is a tiny noexec tmpfs, /workspace is the only writable exec dir', () => {
  const shm = HARDENING_ARGS.find((x) => x.startsWith('/dev/shm'));
  assert.match(shm, /noexec/);
  assert.match(shm, /size=1k/);
  const ws = HARDENING_ARGS.find((x) => x.startsWith('/workspace'));
  assert.match(ws, /exec/);
  assert.match(ws, /size=\d+m/);
});

test('sandbox names are namespaced so orphan reaping can find them', () => {
  assert.equal(NAME_PREFIX, 'judge-');
});

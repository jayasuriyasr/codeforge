'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CONFIG = path.join(__dirname, '..', '..', 'src', 'config.js');

// Load config.js in a clean child process with a controlled environment.
// Returns { code, stdout, stderr }.
function loadConfig(env) {
  const base = { ...process.env };
  // Ensure the child does not inherit a NODE_ENV / secret the caller didn't set.
  delete base.NODE_ENV;
  delete base.JWT_SECRET;
  delete base.FAT_JUDGE_IMAGE;
  const r = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(CONFIG)}); console.log("OK")`],
    { env: { ...base, ...env }, encoding: 'utf8' }
  );
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('production boot with a weak JWT_SECRET fails fast', () => {
  const r = loadConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'secret',
    MONGO_URI: 'mongodb://x/y',
    REDIS_URL: 'redis://x',
    FAT_JUDGE_IMAGE: 'codeforge/fat-judge:latest',
  });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /JWT_SECRET/);
});

test('production boot with the digest placeholder fails fast', () => {
  const r = loadConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    MONGO_URI: 'mongodb://x/y',
    REDIS_URL: 'redis://x',
    FAT_JUDGE_IMAGE: 'codeforge/fat-judge@sha256:<pinned-digest>',
  });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /pinned-digest/);
});

test('production boot with a strong config succeeds', () => {
  const r = loadConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(48),
    MONGO_URI: 'mongodb://x/y',
    REDIS_URL: 'redis://x',
    FAT_JUDGE_IMAGE: 'codeforge/fat-judge@sha256:' + 'a'.repeat(64),
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /OK/);
});

test('development boot with a weak secret warns but still starts', () => {
  const r = loadConfig({ NODE_ENV: 'development', JWT_SECRET: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /WARNING/);
});

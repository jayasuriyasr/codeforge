'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { isInfraFailure } = require('../../src/judge/errors');

test('infra: docker daemon / socket / container faults are infra failures', () => {
  for (const msg of [
    'connect ECONNREFUSED /var/run/docker.sock',
    'Error: spawn docker ENOENT',
    'Error response from daemon: No such container: judge-x',
    'failed to connect to the docker API',
    'ResourceRequest timed out',
  ]) {
    assert.equal(isInfraFailure(new Error(msg)), true, msg);
  }
});

test('infra: ordinary user-code failures are NOT infra failures', () => {
  assert.equal(isInfraFailure(new Error('Command failed: exit code 1')), false);
  assert.equal(isInfraFailure(Object.assign(new Error('killed'), { code: 137, signal: 'SIGKILL' })), false);
  assert.equal(isInfraFailure(null), false);
});

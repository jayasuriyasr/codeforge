'use strict';

// ── Central configuration — single source of truth for every env var ──────────
//
// WHY this module exists:
//   Before v4, env vars were read ad-hoc across ~8 files, each with its own
//   fallback default. `.env.example` advertised keys the code never read
//   (REDIS_HOST/REDIS_PORT) and a Redis port that didn't match docker-compose.
//   JWT_SECRET silently fell back to a hard-coded string, so a missing secret
//   in production meant anyone could forge an admin token with no warning.
//
//   This module loads `.env` once, validates everything, fails fast on a
//   misconfigured production boot, and warns loudly in development. Every other
//   module imports `config` from here — never `process.env` directly.

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

// Values that are obviously not real secrets — refuse them in production.
const WEAK_SECRETS = new Set([
  'change_me_to_a_long_random_string',
  'dev_secret_change_me',
  'secret',
  'changeme',
  '',
]);

const problems = [];
const warnings = [];

// ── JWT ──────────────────────────────────────────────────────────────────────
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || WEAK_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
  if (isProd) {
    problems.push(
      'JWT_SECRET is missing, weak, or shorter than 32 chars. Set a long random ' +
      'string (e.g. `openssl rand -hex 32`).'
    );
  } else if (!isTest) {
    warnings.push(
      'JWT_SECRET is missing or weak — using an insecure development fallback. ' +
      'Tokens signed now are trivially forgeable. Set JWT_SECRET before deploying.'
    );
    jwtSecret = jwtSecret || 'dev-insecure-secret-not-for-production-use-only';
  } else {
    jwtSecret = 'test-secret';
  }
}

// ── Mongo / Redis ────────────────────────────────────────────────────────────
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

if (isProd && !process.env.MONGO_URI) {
  problems.push('MONGO_URI must be set explicitly in production.');
}
if (isProd && !process.env.REDIS_URL) {
  problems.push('REDIS_URL must be set explicitly in production.');
}

// ── Judge image ──────────────────────────────────────────────────────────────
const fatJudgeImage = process.env.FAT_JUDGE_IMAGE || 'codeforge/fat-judge:latest';
if (fatJudgeImage.includes('<pinned-digest>')) {
  problems.push(
    'FAT_JUDGE_IMAGE still contains the "<pinned-digest>" placeholder. Set it to ' +
    'a real tag or digest (see .env.example).'
  );
}
if (isProd && !fatJudgeImage.includes('@sha256:')) {
  warnings.push(
    'FAT_JUDGE_IMAGE is not digest-pinned. The judge environment can drift ' +
    'between runs. Pin it with `docker inspect --format=\'{{index .RepoDigests 0}}\'`.'
  );
}

// ── CORS ─────────────────────────────────────────────────────────────────────
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── Report ───────────────────────────────────────────────────────────────────
if (warnings.length && !isTest) {
  for (const w of warnings) console.warn(`[config] WARNING: ${w}`);
}
if (problems.length) {
  console.error('[config] FATAL — refusing to start:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const config = Object.freeze({
  env: NODE_ENV,
  isProd,
  isTest,

  port: Number(process.env.PORT) || 5000,
  clientOrigins,

  mongoUri,
  redisUrl,

  jwt: Object.freeze({
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  }),

  judge: Object.freeze({
    image: fatJudgeImage,
    // How many jobs one worker runs at once, and how many pre-created idle
    // sandboxes to keep warm. Throughput = workers × concurrency; nothing is
    // hard-coded to "4" any more.
    concurrency: Number(process.env.JUDGE_CONCURRENCY) || 4,
    warmSandboxes: Number(process.env.JUDGE_WARM_SANDBOXES) || 4,
    // Container memory ceiling — a generous HOST-protection limit. The problem's
    // real memory limit is enforced by measurement in the supervisor.
    sandboxMemoryMb: Number(process.env.JUDGE_SANDBOX_MEMORY_MB) || 512,
    workspaceTmpfsMb: Number(process.env.JUDGE_WORKSPACE_TMPFS_MB) || 256,
    pidsLimit: Number(process.env.JUDGE_PIDS_LIMIT) || 64,
    compileTimeoutMs: Number(process.env.JUDGE_COMPILE_TIMEOUT_MS) || 10_000,
    // Hard cap on test cases per judged run (protects the queue lock budget).
    maxCasesPerRun: Number(process.env.JUDGE_MAX_CASES_PER_RUN) || 200,
  }),

  sse: Object.freeze({
    timeoutMs: Number(process.env.SSE_TIMEOUT_MS) || 60_000,
  }),
});

module.exports = config;

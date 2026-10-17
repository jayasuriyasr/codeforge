'use strict';

// Load + validate configuration first. A misconfigured production boot exits here.
const config = require('./config');

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const mongoose = require('mongoose');

const { closeAll: closeRedis } = require('./redis');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: config.clientOrigins }));
app.use(express.json({ limit: '256kb' }));   // hard cap — oversized payloads rejected here
if (!config.isTest) app.use(morgan('dev'));

// ── Health probe ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',        require('./routes/auth'));
app.use('/api/v1/problems',    require('./routes/problems'));
app.use('/api/v1/contests',    require('./routes/contests'));
app.use('/api/v1/submissions', require('./routes/submissions'));
app.use('/api/v1/submissions', require('./routes/submissionStream'));  // SSE — mounted after REST
app.use('/api/v1/leaderboard', require('./routes/leaderboard'));

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

// ── Global error handler ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'internal server error' });
});

// ── Startup ─────────────────────────────────────────────────────────────────
let server;

let workerMod = null;

async function start() {
  await mongoose.connect(config.mongoUri);
  console.log(`[mongo] connected to ${config.mongoUri}`);

  // Start the queue worker only after the DB is reachable.
  workerMod = require('./queue/worker');
  workerMod.start();

  server = app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port} (${config.env})`);
  });
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
// Stop accepting HTTP, let the worker finish its in-flight judge job and tear
// down its sandboxes, then close DB + Redis.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down`);

  if (server) await new Promise((r) => server.close(r));
  if (workerMod && workerMod.drain) {
    await workerMod.drain().catch((e) => console.error('[server] worker drain error:', e.message));
  }
  await Promise.allSettled([mongoose.disconnect(), closeRedis()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] startup failed', err);
    process.exit(1);
  });
}

module.exports = app;

'use strict';

// ── submissionStream.js ─────────────────────────────────────────────────────
// SSE endpoint: GET /api/v1/submissions/:id/stream
//
//   • JWT-authenticated (Bearer header or ?token= for EventSource).
//   • Ownership-checked: only the submission's owner or an admin may stream it.
//   • CATCH-UP: if the submission is already terminal when the client connects
//     (fast judge, or a late reconnect), the verdict is emitted immediately and
//     the stream closes — no waiting out the timeout for an event that already
//     fired on the pub/sub channel.
//   • Otherwise subscribes to Redis channel verdict:${submissionId} and forwards
//     events until a terminal one arrives or SSE_TIMEOUT_MS elapses.
//   • The dedicated subscriber connection is always cleaned up.

const express = require('express');
const Submission = require('../models/Submission');
const { authenticateJWT } = require('../middleware/auth');
const { createSubscriber } = require('../redis');
const config = require('../config');

const router = express.Router({ mergeParams: true });
const SSE_TIMEOUT_MS = config.sse.timeoutMs;

// A submission is finished when its lifecycle status is terminal OR it already
// carries a verdict. Tolerant of both the pre-v4 ('COMPLETED'/'FAILED') and the
// v4 ('DONE'/'ERROR') vocabularies during the migration.
const TERMINAL_STATUS = new Set(['DONE', 'ERROR', 'COMPLETED', 'FAILED']);
const TERMINAL_VERDICT = new Set(['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'INFRA_ERROR']);

function isTerminal(o) {
  return (o && (TERMINAL_STATUS.has(o.status) || TERMINAL_VERDICT.has(o.verdict)));
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

router.get('/:id/stream', authenticateJWT, async (req, res, next) => {
  const submissionId = req.params.id;

  let submission;
  try {
    submission = await Submission.findById(submissionId).lean();
  } catch (err) {
    return next(err);
  }
  if (!submission) return res.status(404).json({ error: 'not found' });

  const owns = submission.userId.toString() === req.user.sub;
  if (!owns && req.user.role !== 'admin') {
    return res.status(404).json({ error: 'not found' });
  }

  // ── SSE headers ────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': heartbeat\n\n');

  // ── Catch-up: already done? emit and close. ───────────────────────────────
  if (isTerminal(submission)) {
    sendSSE(res, {
      type: 'verdict',
      submissionId,
      status: submission.status,
      verdict: submission.verdict ?? null,
      runtimeMs: submission.runtimeMs ?? null,
      memoryMB: submission.memoryMB ?? null,
      ...(submission.failedTestCase ? { failedTestCase: submission.failedTestCase } : {}),
    });
    return res.end();
  }

  // ── Live: subscribe to the verdict channel. ───────────────────────────────
  const channel = `verdict:${submissionId}`;
  const sub = createSubscriber(`sse:${submissionId}`);
  let cleaned = false;

  function cleanup(reason) {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timeoutHandle);
    sub.unsubscribe(channel)
      .then(() => sub.quit())
      .catch(() => sub.disconnect());
  }

  const timeoutHandle = setTimeout(() => {
    sendSSE(res, { type: 'timeout', message: `stream timed out after ${SSE_TIMEOUT_MS} ms` });
    res.end();
    cleanup('timeout');
  }, SSE_TIMEOUT_MS);

  req.on('close', () => cleanup('client-disconnect'));

  sub.subscribe(channel, (err) => {
    if (err) {
      sendSSE(res, { type: 'error', message: 'internal subscription error' });
      res.end();
      cleanup('subscribe-error');
    }
  });

  sub.on('message', (_chan, raw) => {
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    sendSSE(res, { type: 'verdict', ...payload });
    if (isTerminal(payload)) {
      res.end();
      cleanup('terminal-verdict');
    }
  });

  sub.on('error', (err) => {
    console.error(`[stream] ${submissionId} subscriber error:`, err.message);
  });
});

module.exports = router;

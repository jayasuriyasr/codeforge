'use strict';

// ── publisher.js ─────────────────────────────────────────────────────────────
// Publishes verdict events to a per-submission Redis Pub/Sub channel so the SSE
// endpoint can push them to a connected client.
//
//   channel: verdict:${submissionId}
//   payload: JSON { submissionId, status, verdict, runtimeMs, ... }
//
// Uses the shared general-purpose client (PUBLISH is non-blocking and must not
// run on a connection in subscriber mode). A publish failure is non-fatal — the
// authoritative result is already in Mongo and the client falls back to polling
// / the SSE catch-up path.

const { redis } = require('../redis');

async function publishVerdict(submissionId, payload) {
  const channel = `verdict:${submissionId}`;
  try {
    await redis.publish(channel, JSON.stringify({ submissionId, ...payload }));
  } catch (err) {
    console.error(`[publisher] failed to publish ${channel}:`, err.message);
  }
}

module.exports = { publishVerdict };

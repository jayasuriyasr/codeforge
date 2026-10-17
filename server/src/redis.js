'use strict';

// ── Shared Redis clients ─────────────────────────────────────────────────────
//
// Before v4 there were ~6 independent `new Redis(process.env.REDIS_URL || ...)`
// calls scattered across routes, the queue, the worker and the publisher — each
// opening its own connection, some with the wrong options.
//
// Redis connection rules this module encodes:
//   • BullMQ REQUIRES `maxRetriesPerRequest: null` (it issues blocking commands).
//     A normal command client must NOT use that setting.
//   • A connection in subscriber mode (SUBSCRIBE) can only issue (P)SUBSCRIBE /
//     (P)UNSUBSCRIBE / PING — so every SSE stream needs its own subscriber.
//
// Exports (all lazy — requiring this file NEVER opens a socket, so unit tests
// that inject fakes leave the real client unconnected and the process can exit):
//   redis            — shared general-purpose client
//   bullConnection   — dedicated client for BullMQ Queue + Worker
//   createSubscriber() — fresh subscriber connection for one SSE request

const Redis = require('ioredis');
const config = require('./config');

let _redis = null;
let _bull = null;

function makeClient(opts) {
  const name = opts.connectionName || 'client';
  const client = new Redis(config.redisUrl, {
    lazyConnect: true, // no socket until the first command / .connect()
    // Bounded backoff; keep reconnecting so a Redis restart self-heals.
    retryStrategy: (times) => Math.min(times * 200, 3000),
    ...opts,
  });

  // Log the first error and then stay quiet until the connection recovers, so a
  // Redis outage doesn't produce a firehose of identical lines.
  let muted = false;
  client.on('error', (err) => {
    if (muted) return;
    muted = true;
    console.error(`[redis] ${name} error: ${err.code || err.message} (further errors muted until reconnect)`);
  });
  client.on('ready', () => {
    if (muted) console.log(`[redis] ${name} connected`);
    muted = false;
  });

  return client;
}

function getRedis() {
  if (!_redis) _redis = makeClient({ connectionName: 'app' });
  return _redis;
}

function getBullConnection() {
  if (!_bull) _bull = makeClient({ connectionName: 'bullmq', maxRetriesPerRequest: null });
  return _bull;
}

/**
 * Dedicated subscriber connection. The caller owns its lifecycle and MUST call
 * `.quit()` / `.disconnect()` when done (typically on SSE close).
 */
function createSubscriber(name = 'sse-sub') {
  return makeClient({ connectionName: name });
}

/** Close the shared connections — graceful shutdown + tests. */
async function closeAll() {
  await Promise.allSettled([_redis?.quit(), _bull?.quit()]);
  _redis = null;
  _bull = null;
}

module.exports = {
  get redis() { return getRedis(); },
  get bullConnection() { return getBullConnection(); },
  createSubscriber,
  closeAll,
};

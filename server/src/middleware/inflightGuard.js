'use strict';

// ── Per-user in-flight submission guard ──────────────────────────────────────
// Enforces one in-flight submission per user (arch doc §1).
//
//   SET inflight:${userId} 1 NX EX 30
//     'OK'  → slot acquired, continue
//     null  → a submission is already running → 409
//
// EX 30: if a worker dies mid-job the key self-heals after 30s. The worker's
// finally block also deletes it on the normal path.
//
// `req.releaseInflightSlot()` is attached so a route that bails after this
// middleware (validation failure) can free the slot immediately.

const { redis: sharedRedis } = require('../redis');

const KEY_PREFIX = 'inflight:';
const EXPIRY_SEC = 30;

/**
 * @param {import('ioredis').Redis} [redis] injectable for tests; defaults to the
 *        shared client.
 */
function inflightGuard(redis = sharedRedis) {
  return async function inflightMiddleware(req, res, next) {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: 'authentication required' });

    const key = `${KEY_PREFIX}${userId}`;
    try {
      const ok = await redis.set(key, '1', 'NX', 'EX', EXPIRY_SEC);
      if (ok !== 'OK') {
        return res.status(409).json({
          error: 'you already have a submission in progress — wait for it to complete',
        });
      }
      req.releaseInflightSlot = () => redis.del(key).catch(() => {});
      next();
    } catch (err) {
      console.error('[inflightGuard] Redis error, failing open:', err.message);
      next();
    }
  };
}

module.exports = { inflightGuard, KEY_PREFIX, EXPIRY_SEC };

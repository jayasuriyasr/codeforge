'use strict';

// ── Redis-backed sliding-window rate limiters ───────────────────────────────
//
// One sorted-set sliding window implementation, two configured instances:
//   • submitRateLimiter — 10 submissions / 60s, keyed by user id
//   • authRateLimiter   — 20 attempts / 300s, keyed by client IP (login/register
//                          brute-force protection; there is no user id yet here)
//
// Sliding window mechanics:
//   ZADD key <now> <now>:<uuid>            unique member per request
//   ZREMRANGEBYSCORE key 0 <windowStart>   evict expired
//   ZCARD key                              count in window (includes this request)
//   EXPIRE key <windowSec>                 let idle keys disappear
//
// Add-then-count: at exactly `max` we allow, at `max + 1` we block.
// Redis failure ⇒ fail open (don't wedge the whole app on a cache blip).

const { randomUUID } = require('crypto');
const { redis: sharedRedis } = require('../redis');

/**
 * @param {object}   opts
 * @param {string}   opts.keyPrefix
 * @param {number}   opts.windowSec
 * @param {number}   opts.max
 * @param {(req) => string|undefined} opts.keyFn   identity to limit on
 * @param {string}   [opts.message]
 * @param {import('ioredis').Redis} [opts.redis]   injectable for tests
 */
function slidingWindow({ keyPrefix, windowSec, max, keyFn, message, redis = sharedRedis }) {
  return async function rateLimitMiddleware(req, res, next) {
    const identity = keyFn(req);
    if (!identity) return next(); // nothing to key on — downstream will 401 if needed

    const key = `${keyPrefix}${identity}`;
    const now = Date.now();
    const windowStart = now - windowSec * 1000;

    try {
      const results = await redis
        .pipeline()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, `${now}:${randomUUID()}`)
        .zcard(key)
        .expire(key, windowSec)
        .exec();

      const count = results[2][1];
      if (count > max) {
        return res.status(429).json({
          error: message || `rate limit exceeded — max ${max} requests per ${windowSec}s`,
        });
      }
      next();
    } catch (err) {
      console.error(`[rateLimiter] Redis error on ${keyPrefix}, failing open:`, err.message);
      next();
    }
  };
}

function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || 'unknown').replace(/[^a-zA-Z0-9:._-]/g, '');
}

/**
 * Submission limiter factory. `redis` is injectable for tests; production callers
 * pass nothing and get the shared client.
 */
function rateLimiter(redis = sharedRedis) {
  return slidingWindow({
    keyPrefix: 'ratelimit:submit:',
    windowSec: 60,
    max: 10,
    keyFn: (req) => req.user?.sub,
    message: 'rate limit exceeded — max 10 submissions per 60s',
    redis,
  });
}

const submitRateLimiter = rateLimiter();

const authRateLimiter = slidingWindow({
  keyPrefix: 'ratelimit:auth:',
  windowSec: 300,
  max: 20,
  keyFn: clientIp,
  message: 'too many attempts — try again in a few minutes',
});

module.exports = {
  rateLimiter,
  submitRateLimiter,
  authRateLimiter,
  slidingWindow,
  WINDOW_SEC: 60,
  MAX_REQUESTS: 10,
};

'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const JWT_SECRET = config.jwt.secret;

/** Pull a token from `Authorization: Bearer` (preferred) or `?token=` (EventSource). */
function extractToken(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.query?.token || null;
}

// ── authenticateJWT ───────────────────────────────────────────────────────────
// Verifies the Bearer token in the Authorization header and attaches the
// decoded payload to req.user.
//
// Pipeline position: FIRST in the middleware chain.
// An unauthenticated request is rejected here — before rate limiting, inflight
// guard, or eligibility checks ever run.
//
// req.user shape after verification:
//   { sub: <userId string>, role: 'admin'|'contestant', iat, exp }

/**
 * Express middleware. Rejects with 401 if no valid JWT is present.
 */
function authenticateJWT(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'authentication required — no token provided' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);   // { sub, role, iat, exp }
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'token expired' : 'invalid token';
    return res.status(401).json({ error: msg });
  }
}

/**
 * Populate req.user IF a valid token is present, otherwise continue anonymously.
 * For endpoints that serve everyone but tailor the response (e.g. admins see
 * private test cases, anonymous users do not).
 */
function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* stay anonymous */ }
  }
  next();
}

/**
 * Role guard — call after authenticateJWT.
 * requireRole('admin') rejects non-admin users with 403.
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication required' });
    if (req.user.role !== role) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { authenticateJWT, optionalAuth, requireRole, extractToken };

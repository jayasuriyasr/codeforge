'use strict';

const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const express  = require('express');
const User     = require('../models/User');
const config   = require('../config');
const { authRateLimiter } = require('../middleware/rateLimiter');

const router   = express.Router();
const JWT_SECRET   = config.jwt.secret;
const JWT_EXPIRES  = config.jwt.expiresIn;
const BCRYPT_ROUNDS = 12;

// ── Token helpers ──────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// Brute-force protection on both credential endpoints (keyed by client IP).
router.use(['/register', '/login'], authRateLimiter);

// ── POST /api/v1/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'password must be ≥ 8 characters' });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ email, passwordHash, displayName });
    const token = signToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'email already registered' });
    next(err);
  }
});

// ── POST /api/v1/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    res.json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

// ── GET /api/v1/auth/me ────────────────────────────────────────────────────────
const { authenticateJWT } = require('../middleware/auth');
router.get('/me', authenticateJWT, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;

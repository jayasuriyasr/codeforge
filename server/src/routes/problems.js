'use strict';

const express = require('express');
const Problem = require('../models/Problem');
const { authenticateJWT, optionalAuth, requireRole } = require('../middleware/auth');
const { assertProblemLimits } = require('../utils/validation');

const router = express.Router();

// ── Test-case visibility (v4) ───────────────────────────────────────────────
// Admins always see everything. Otherwise:
//   practice → every test case is public
//   contest  → only `isSample` cases; the rest are private and must never reach
//              a non-admin client (they run server-side only).
function visibleTestCases(problem, user) {
  const cases = problem.testCases || [];
  if (user?.role === 'admin') return cases;
  if (problem.mode === 'practice') return cases;
  return cases.filter((tc) => tc.isSample);
}

// ── GET /api/v1/problems ─────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    // Never send any test cases in the list view.
    const problems = await Problem.find({}, '-testCases').lean();
    res.json({ problems });
  } catch (err) { next(err); }
});

// ── GET /api/v1/problems/:id ────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const problem = await Problem.findById(req.params.id).lean();
    if (!problem) return res.status(404).json({ error: 'not found' });

    problem.testCases = visibleTestCases(problem, req.user);
    res.json({ problem });
  } catch (err) { next(err); }
});

function assertCheckerConfig(body) {
  if (body.checkerType === 'special' && (!body.checker || !body.checker.source || !body.checker.language)) {
    const e = new Error('checkerType "special" requires checker.language and checker.source');
    e.status = 400;
    throw e;
  }
}

// ── POST /api/v1/problems (admin) ───────────────────────────────────────────
router.post('/', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    assertProblemLimits(req.body);
    assertCheckerConfig(req.body);
    const problem = await Problem.create(req.body);
    res.status(201).json({ problem });
  } catch (err) {
    if (err.name === 'ValidationError' || err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── PUT /api/v1/problems/:id (admin) ────────────────────────────────────────
router.put('/:id', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    assertProblemLimits(req.body);
    assertCheckerConfig(req.body);
    const problem = await Problem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!problem) return res.status(404).json({ error: 'not found' });
    res.json({ problem });
  } catch (err) {
    if (err.name === 'ValidationError' || err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── DELETE /api/v1/problems/:id (admin) ─────────────────────────────────────
router.delete('/:id', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const problem = await Problem.findByIdAndDelete(req.params.id);
    if (!problem) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.visibleTestCases = visibleTestCases;   // exported for unit tests

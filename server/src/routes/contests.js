'use strict';

const express = require('express');
const Contest = require('../models/Contest');
const Submission = require('../models/Submission');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { rebuildContest } = require('../leaderboard');
const { enqueueSubmission } = require('../queue/setup');

const router = express.Router();

// ── GET /api/v1/contests ────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const contests = await Contest.find().sort({ startTime: -1 }).lean();
    res.json({ contests });
  } catch (err) { next(err); }
});

// ── GET /api/v1/contests/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const contest = await Contest.findById(req.params.id).lean();
    if (!contest) return res.status(404).json({ error: 'not found' });
    res.json({ contest });
  } catch (err) { next(err); }
});

// ── POST /api/v1/contests (admin) ───────────────────────────────────────────
router.post('/', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const contest = await Contest.create({ ...req.body, createdBy: req.user.sub });
    res.status(201).json({ contest });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── PUT /api/v1/contests/:id (admin) ────────────────────────────────────────
router.put('/:id', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const contest = await Contest.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!contest) return res.status(404).json({ error: 'not found' });
    res.json({ contest });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── DELETE /api/v1/contests/:id (admin) ─────────────────────────────────────
router.delete('/:id', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const contest = await Contest.findByIdAndDelete(req.params.id);
    if (!contest) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── POST /api/v1/contests/:id/system-test (admin) ──────────────────────────
// Re-judge every provisional (pretest-only) submission on the full test set.
router.post('/:id/system-test', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const contest = await Contest.findById(req.params.id).select('_id').lean();
    if (!contest) return res.status(404).json({ error: 'not found' });

    const provisional = await Submission.find({ contestId: req.params.id, provisional: true })
      .select('_id').lean();
    for (const s of provisional) {
      await enqueueSubmission({ submissionId: s._id, systemTest: true });
    }
    res.json({ requeued: provisional.length });
  } catch (err) { next(err); }
});

// ── POST /api/v1/contests/:id/rebuild-standings (admin) ────────────────────
// Recompute the contest leaderboard from Mongo (source of truth). Run after a
// system-test pass, or to repair drift.
router.post('/:id/rebuild-standings', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const contest = await Contest.findById(req.params.id).select('startTime').lean();
    if (!contest) return res.status(404).json({ error: 'not found' });
    const users = await rebuildContest(req.params.id, contest.startTime);
    res.json({ rebuilt: users });
  } catch (err) { next(err); }
});

module.exports = router;

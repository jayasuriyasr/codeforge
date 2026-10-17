'use strict';

const express = require('express');
const Submission = require('../models/Submission');
const Problem = require('../models/Problem');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');
const { inflightGuard } = require('../middleware/inflightGuard');
const { assertContestEligible } = require('../middleware/contestEligibility');

const router = express.Router();

// ── GET /api/v1/submissions/admin/recent (Admin only) ───────────────────────
router.get('/admin/recent', authenticateJWT, requireRole('admin'), async (req, res, next) => {
  try {
    const submissions = await Submission.find({}, 'userId problemId contestId language status verdict createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ submissions });
  } catch (err) { next(err); }
});

// A submission (and its source code, failing test case, …) is visible only to
// its owner and to admins. Previously any authenticated user could read any
// submission by id — a direct leak of other contestants' solutions.
router.get('/:id', authenticateJWT, async (req, res, next) => {
  try {
    const sub = await Submission.findById(req.params.id).lean();
    if (!sub) return res.status(404).json({ error: 'not found' });
    const owns = sub.userId.toString() === req.user.sub;
    if (!owns && req.user.role !== 'admin') {
      return res.status(404).json({ error: 'not found' });   // don't confirm existence
    }
    res.json(sub);
  } catch (err) { next(err); }
});

// ── GET /api/v1/submissions/problem/:problemId ──────────────────────────────
router.get('/problem/:problemId', authenticateJWT, async (req, res, next) => {
  try {
    const submissions = await Submission.find({ 
      problemId: req.params.problemId, 
      userId: req.user.sub 
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ submissions });
  } catch (err) { next(err); }
});

// ── POST /api/v1/submissions ──────────────────────────────────────────────────
// Wire the middleware chain in EXACT order per Phase 2 requirements:
// JWT Auth → Rate Limiter → Inflight Guard → Contest Eligibility → Route Handler
router.post(
  '/',
  authenticateJWT,
  rateLimiter(),
  inflightGuard(),
  assertContestEligible,
  async (req, res, next) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'];
      if (!idempotencyKey) {
        if (req.releaseInflightSlot) await req.releaseInflightSlot();
        return res.status(400).json({ error: 'Idempotency-Key header is required' });
      }

      // CRITICAL: Destructure AFTER the contest eligibility middleware, which may
      // have mutated contestId to null if the submission was ineligible.
      const { problemId, code, language, contestId } = req.body;

      if (!problemId || !code || !language) {
        if (req.releaseInflightSlot) await req.releaseInflightSlot();
        return res.status(400).json({ error: 'problemId, code, and language are required' });
      }

      // Namespace the idempotency key per user so two users cannot collide (and
      // one cannot replay another's key to read their submission back).
      const submissionId = `${req.user.sub}:${idempotencyKey}`;

      let submission;
      try {
        submission = await Submission.create({
          _id: submissionId,
          userId: req.user.sub,
          problemId,
          contestId: contestId || null,
          code,
          language,
          status: 'QUEUED',
        });

        const { enqueueSubmission } = require('../queue/setup');
        const problem = await Problem.findById(problemId).lean();
        await enqueueSubmission({ submissionId, problem });
      } catch (err) {
        if (err.code !== 11000) throw err;   // only swallow the duplicate-key case
        // Same user replaying the same key — return their existing submission.
        submission = await Submission.findById(submissionId);
        if (submission && submission.userId.toString() !== req.user.sub) {
          return res.status(409).json({ error: 'idempotency key conflict' });
        }
        return res.status(200).json({ submission });
      }

      res.status(201).json({ submission });
    } catch (err) {
      if (req.releaseInflightSlot) await req.releaseInflightSlot();
      next(err);
    }
  }
);

module.exports = router;

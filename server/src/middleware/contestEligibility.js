'use strict';

const Contest = require('../models/Contest');

// ── Contest eligibility middleware ────────────────────────────────────────────
// Checks whether a submission is eligible to count toward a contest.
// On INELIGIBLE: mutates req.body.contestId = null (demotes to casual practice).
// On ELIGIBLE:   passes through unchanged.
// NEVER rejects the submission outright — ineligible submissions still run,
// they just don't affect standings.
//
// Pipeline position: FOURTH — after auth, rate limiter, and inflight guard.
//
// CRITICAL: This middleware MUST run before the route handler destructures
// req.body.  The route reads req.body.contestId AFTER this middleware has had
// a chance to nullify it.  If the route destructures first, the demotion is lost.
//
// Eligibility conditions (both must hold):
//   1. The current time is within [contest.startTime, contest.endTime].
//   2. The problemId being submitted is listed in contest.problemIds.
//
// If req.body.contestId is absent or null, this middleware is a no-op.

/**
 * Express middleware.
 * Mutates req.body.contestId to null if the submission is ineligible.
 */
async function assertContestEligible(req, res, next) {
  // No contestId → casual practice submission, nothing to check.
  const { contestId, problemId } = req.body || {};
  if (!contestId) return next();

  try {
    const contest = await Contest.findById(contestId).lean();

    if (!contest) {
      req.body.contestId = null;   // no such contest — demote silently
      return next();
    }

    const now = new Date();
    const inWindow = now >= new Date(contest.startTime) && now <= new Date(contest.endTime);
    const inProblemSet = (contest.problemIds || []).some(
      (id) => id.toString() === (problemId || '').toString()
    );
    // Private contests only count submissions from registered participants.
    const uid = req.user?.sub;
    const mayParticipate = contest.isPublic !== false
      || (contest.participants || []).some((p) => p.toString() === String(uid));

    if (!inWindow || !inProblemSet || !mayParticipate) {
      req.body.contestId = null;   // demote — submission still runs, just doesn't score
    }

    next();
  } catch (err) {
    // DB failure — demote and continue rather than blocking the submission
    console.error('[contestEligibility] DB error, demoting to casual:', err.message);
    req.body.contestId = null;
    next();
  }
}

module.exports = { assertContestEligible };

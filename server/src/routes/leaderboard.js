'use strict';

const express = require('express');
const Contest = require('../models/Contest');
const { getGlobalStandings, getContestStandings, rebuildContest } = require('../leaderboard');

const router = express.Router();

// ── GET /api/v1/leaderboard[?contestId=...] ─────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { contestId } = req.query;

    if (!contestId) {
      const { rows, source } = await getGlobalStandings(100);
      return res.json({ leaderboard: rows, source });
    }

    const contest = await Contest.findById(contestId).select('startTime endTime title').lean();
    if (!contest) return res.status(404).json({ error: 'contest not found' });

    let { rows, source } = await getContestStandings(contestId, 200);
    // Cold board (server restarted mid-contest, or never populated) — rebuild once.
    if (source === 'empty') {
      await rebuildContest(contestId, contest.startTime).catch(() => {});
      ({ rows, source } = await getContestStandings(contestId, 200));
      if (source === 'empty') source = 'mongodb';
    }
    res.json({ leaderboard: rows, source, contest: { title: contest.title } });
  } catch (err) { next(err); }
});

module.exports = router;

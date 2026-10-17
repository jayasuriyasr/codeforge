'use strict';

// ── Leaderboard (v4) ────────────────────────────────────────────────────────
//
// Global board  : rank by distinct problems solved (practice + contest).
// Contest board : ICPC scoring — rank by (problems solved DESC, penalty ASC).
//   penalty for a solved problem = minutes-from-contest-start at the first AC
//                                + 20 × (rejected attempts before that AC)
//   CE does NOT count as an attempt.
//
// A single ZSET score encodes both keys so ranking is a plain ZREVRANGE:
//   score = solved × 1e7 − penaltyMinutes         (1e7 ≫ any realistic penalty)
//
// During a contest the ZSET is updated incrementally by an atomic Lua script
// (kills the check-then-ZINCRBY double-count race). After a contest / system
// test, `rebuildContest` recomputes the whole board from Mongo — the source of
// truth if pretests and system tests disagree.

const { redis } = require('./redis');
const Submission = require('./models/Submission');
const User = require('./models/User');

const SOLVE_WEIGHT = 10_000_000;
const PENALTY_PER_REJECT = 20;
const REJECT_VERDICTS = new Set(['WA', 'TLE', 'MLE', 'RE']);

const gKeys = { z: 'lb:global:z' };
const cKeys = (cid) => ({
  z: `lb:contest:${cid}:z`,
  solved: `lb:contest:${cid}:solved`,   // SET  "uid:pid"
  att: `lb:contest:${cid}:att`,         // HASH "uid:pid" -> rejected-before-AC count
  sc: `lb:contest:${cid}:sc`,           // HASH uid -> solved count
  pen: `lb:contest:${cid}:pen`,         // HASH uid -> total penalty
});

// KEYS = z, solved, att, sc, pen   ARGV = uid, pid, verdict, elapsedMinutes
const RECORD_LUA = `
local z, solved, att, sc, pen = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local uid, pid, verdict, elapsed = ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4])
local W = ${SOLVE_WEIGHT}
local member = uid .. ':' .. pid
if redis.call('SISMEMBER', solved, member) == 1 then return 'noop' end
if verdict == 'AC' then
  redis.call('SADD', solved, member)
  local attempts = tonumber(redis.call('HGET', att, member) or '0')
  local penalty = elapsed + ${PENALTY_PER_REJECT} * attempts
  local ns = redis.call('HINCRBY', sc, uid, 1)
  local np = tonumber(redis.call('HINCRBYFLOAT', pen, uid, penalty))
  redis.call('ZADD', z, ns * W - np, uid)
  return 'ac'
elseif verdict == 'WA' or verdict == 'TLE' or verdict == 'MLE' or verdict == 'RE' then
  redis.call('HINCRBY', att, member, 1)
  return 'rej'
end
return 'skip'`;

/**
 * Record one terminal verdict against the contest board (atomic, idempotent for
 * a problem already solved). No-op if not a contest submission.
 */
async function recordContestVerdict({ contestId, userId, problemId, verdict, submittedAt, contestStart }) {
  if (!contestId) return;
  const k = cKeys(contestId);
  const elapsedMin = Math.max(0, Math.floor((new Date(submittedAt) - new Date(contestStart)) / 60000));
  try {
    await redis.eval(RECORD_LUA, 5, k.z, k.solved, k.att, k.sc, k.pen,
      String(userId), String(problemId), verdict, String(elapsedMin));
  } catch (err) {
    console.error('[leaderboard] recordContestVerdict failed:', err.message);
  }
}

/** Distinct-problems-solved bump for the global board (first AC on a problem only). */
async function recordGlobalSolve(userId) {
  try { await redis.zincrby(gKeys.z, 1, String(userId)); } catch { /* non-fatal */ }
}

// ── Rebuilds (source of truth) ─────────────────────────────────────────────

/**
 * Pure ICPC standings computation from a time-ordered submission list.
 * @param {Array<{userId,problemId,verdict,createdAt}>} subs  ascending by createdAt
 * @param {Date|string} contestStart
 * @returns {{ agg: Map<string,{solved:number,penalty:number}>, solvedKeys: string[] }}
 */
function computeStandings(subs, contestStart) {
  const start = new Date(contestStart);
  const firstAc = new Map();   // "uid:pid" -> penalty
  const rejects = new Map();   // "uid:pid" -> rejects before AC

  for (const s of subs) {
    const key = `${s.userId}:${s.problemId}`;
    if (firstAc.has(key)) continue;
    if (s.verdict === 'AC') {
      const before = rejects.get(key) || 0;
      const elapsed = Math.max(0, Math.floor((new Date(s.createdAt) - start) / 60000));
      firstAc.set(key, elapsed + PENALTY_PER_REJECT * before);
    } else if (REJECT_VERDICTS.has(s.verdict)) {
      rejects.set(key, (rejects.get(key) || 0) + 1);
    }
  }

  const agg = new Map();
  for (const [key, penalty] of firstAc) {
    const uid = key.split(':')[0];
    const a = agg.get(uid) || { solved: 0, penalty: 0 };
    a.solved += 1;
    a.penalty += penalty;
    agg.set(uid, a);
  }
  return { agg, solvedKeys: [...firstAc.keys()] };
}

async function rebuildContest(contestId, contestStart) {
  const subs = await Submission.find({ contestId }).sort({ createdAt: 1 })
    .select('userId problemId verdict createdAt').lean();

  const { agg, solvedKeys } = computeStandings(subs, contestStart);

  const k = cKeys(contestId);
  const pipe = redis.pipeline();
  pipe.del(k.z, k.solved, k.att, k.sc, k.pen);
  for (const [uid, a] of agg) {
    pipe.zadd(k.z, a.solved * SOLVE_WEIGHT - a.penalty, uid);
    pipe.hset(k.sc, uid, a.solved);
    pipe.hset(k.pen, uid, a.penalty);
  }
  for (const key of solvedKeys) pipe.sadd(k.solved, key);
  await pipe.exec();
  return agg.size;
}

async function rebuildGlobal() {
  const rows = await Submission.aggregate([
    { $match: { verdict: 'AC' } },
    { $group: { _id: '$userId', solved: { $addToSet: '$problemId' } } },
    { $project: { userId: '$_id', score: { $size: '$solved' } } },
  ]);
  const pipe = redis.pipeline();
  pipe.del(gKeys.z);
  for (const r of rows) pipe.zadd(gKeys.z, r.score, String(r.userId));
  pipe.expire(gKeys.z, 3600);
  await pipe.exec();
  return rows.map((r) => ({ userId: String(r.userId), solved: r.score }));
}

// ── Reads ─────────────────────────────────────────────────────────────────
async function attachNames(rows) {
  const ids = rows.map((r) => r.userId);
  const users = await User.find({ _id: { $in: ids } }).select('displayName email').lean();
  const byId = new Map(users.map((u) => [String(u._id), u.displayName || u.email || 'user']));
  return rows.map((r, i) => ({ rank: i + 1, name: byId.get(r.userId) || 'user', ...r }));
}

async function getContestStandings(contestId, limit = 100) {
  const k = cKeys(contestId);
  const raw = await redis.zrevrange(k.z, 0, limit - 1);
  if (!raw.length) return { rows: [], source: 'empty' };
  const [scList, penList] = await Promise.all([redis.hmget(k.sc, ...raw), redis.hmget(k.pen, ...raw)]);
  const rows = raw.map((uid, i) => ({
    userId: uid,
    solved: Number(scList[i] || 0),
    penalty: Math.round(Number(penList[i] || 0)),
  }));
  return { rows: await attachNames(rows), source: 'redis' };
}

async function getGlobalStandings(limit = 100) {
  let raw = await redis.zrevrange(gKeys.z, 0, limit - 1, 'WITHSCORES');
  if (!raw.length) {
    const rebuilt = await rebuildGlobal();
    rebuilt.sort((a, b) => b.solved - a.solved);
    return { rows: await attachNames(rebuilt.slice(0, limit)), source: 'mongodb' };
  }
  const rows = [];
  for (let i = 0; i < raw.length; i += 2) rows.push({ userId: raw[i], solved: Number(raw[i + 1]) });
  return { rows: await attachNames(rows), source: 'redis' };
}

module.exports = {
  recordContestVerdict,
  recordGlobalSolve,
  rebuildContest,
  rebuildGlobal,
  getContestStandings,
  getGlobalStandings,
  computeStandings,
  SOLVE_WEIGHT,
  PENALTY_PER_REJECT,
  _cKeys: cKeys,
};

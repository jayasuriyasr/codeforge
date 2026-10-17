'use strict';

const mongoose = require('mongoose');

// ── Sub-schemas ──────────────────────────────────────────────────────────────

const testCaseSchema = new mongoose.Schema(
  {
    input:          { type: String, required: true },
    expectedOutput: { type: String, required: true },
    // Public case: shown to the user, runnable in the browser. In 'contest' mode
    // only these are returned to non-admin clients.
    isSample:       { type: Boolean, default: false },
    // Contest 'pretest': run during the contest window for a fast provisional
    // verdict. The full set runs in the post-contest system-test pass. (Phase 3.)
    pretest:        { type: Boolean, default: false },
    label:          { type: String },                  // optional human label, e.g. "Edge case 1"
  },
  { _id: true }
);

// ── Main schema ──────────────────────────────────────────────────────────────

const problemSchema = new mongoose.Schema(
  {
    title: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 200,
    },

    // URL-safe identifier used in routes, e.g. "two-sum"
    slug: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
      lowercase: true,
      match:    [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case'],
    },

    statement: {
      type:     String,
      required: true,      // Markdown / HTML — the full problem description
    },

    // ── Judging mode (v4) ────────────────────────────────────────────────────
    //  'practice' — every test case is public. Judged entirely in the browser;
    //               GET /problems/:id returns all test cases.
    //  'contest'  — only `isSample` test cases are public. The rest are private:
    //               they run server-side only and are never returned to a
    //               non-admin client.
    mode: {
      type:    String,
      enum:    ['practice', 'contest'],
      default: 'practice',
    },

    testCases: {
      type:    [testCaseSchema],
      default: [],
    },

    // ── Judge limits (assertProblemLimits guards both fields) ──────────────────
    //  MAX ceiling: timeLimitSec  ≤ 10  (MAX_ALLOWED_TIME_LIMIT_SEC)
    //               memoryLimitMB ≤ 256 (POOL_DEFAULT_MEMORY_MB)
    timeLimitSec: {
      type:     Number,
      required: true,
      min:      [0.5,  'timeLimitSec must be ≥ 0.5'],
      max:      [10,   'timeLimitSec must be ≤ 10 (queue ceiling)'],
    },

    memoryLimitMB: {
      type:     Number,
      required: true,
      min:      [16,   'memoryLimitMB must be ≥ 16'],
      max:      [256,  'memoryLimitMB must be ≤ 256 (container ceiling)'],
    },

    // Drives which checker is used at verdict time (§7 of arch doc)
    checkerType: {
      type:    String,
      enum:    ['exact', 'float', 'special'],
      default: 'exact',
    },

    // Custom checker source — used only when checkerType === 'special'. Compiled
    // and run in its own sandbox: `<checker> input output expected`, exit 0 = AC.
    checker: {
      language: { type: String, enum: ['c', 'cpp', 'python', 'javascript'] },
      source:   { type: String, maxlength: 100_000 },
    },

    // Free-form constraints block shown in the problem statement
    // e.g. { n: "1 ≤ n ≤ 10^5", time: "1s", memory: "256 MB" }
    constraints: {
      type:  mongoose.Schema.Types.Mixed,
      default: {},
    },

    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
    },

    // The admin who created / last modified this problem
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },
  },
  {
    timestamps: true,
  }
);

// Note: slug index is created automatically by `unique: true` above.
// No manual problemSchema.index() needed — adding one would duplicate it.

module.exports = mongoose.model('Problem', problemSchema);

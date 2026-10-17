'use strict';

const mongoose = require('mongoose');

const contestSchema = new mongoose.Schema(
  {
    title: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 200,
    },

    description: {
      type: String,
      default: '',
    },

    // ISO timestamps — used by the eligibility middleware to decide whether a
    // submission counts toward the contest or is demoted to casual practice.
    startTime: {
      type:     Date,
      required: true,
    },

    endTime: {
      type:     Date,
      required: true,
    },

    // Ordered list of Problems included in this contest
    problemIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'Problem',
      },
    ],

    // Users who have registered for this contest
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  'User',
      },
    ],

    // admin who created the contest
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },

    isPublic: {
      type:    Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Guard: endTime must be after startTime
contestSchema.pre('validate', function (next) {
  if (this.endTime && this.startTime && this.endTime <= this.startTime) {
    this.invalidate('endTime', 'endTime must be after startTime');
  }
  next();
});

// Index for active-contest queries: find contests currently in progress
contestSchema.index({ startTime: 1, endTime: 1 });

module.exports = mongoose.model('Contest', contestSchema);

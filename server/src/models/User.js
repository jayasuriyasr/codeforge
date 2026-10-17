'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type:     String,
      required: true,
      unique:   true,
      trim:     true,
      lowercase: true,
      match:    [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    passwordHash: {
      type:     String,
      required: true,
    },
    role: {
      type:    String,
      enum:    ['admin', 'contestant'],
      default: 'contestant',
    },
    displayName: {
      type:  String,
      trim:  true,
      maxlength: 64,
    },
  },
  {
    timestamps: true,   // createdAt, updatedAt
  }
);

// Never serialise the hash to JSON (API responses, logs)
userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);

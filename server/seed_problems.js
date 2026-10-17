'use strict';
// seed_problems.js — inserts sample problems for the Phase 6.2 demo.
// Run once: node seed_problems.js
require('dotenv').config();
const mongoose = require('mongoose');
const Problem  = require('./src/models/Problem');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge';

const PROBLEMS = [
  {
    title: 'Two Sum',
    slug: 'two-sum',
    statement: 'Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to target.',
    difficulty: 'easy',
    timeLimitSec: 1,
    memoryLimitMB: 128,
    checkerType: 'exact',
    testCases: [{ input: '2 7 11 15\n9', expectedOutput: '0 1', isSample: true }],
  },
  {
    title: 'Longest Substring Without Repeating Characters',
    slug: 'longest-substring-no-repeat',
    statement: 'Given a string `s`, find the length of the longest substring without repeating characters.',
    difficulty: 'medium',
    timeLimitSec: 2,
    memoryLimitMB: 128,
    checkerType: 'exact',
    testCases: [{ input: 'abcabcbb', expectedOutput: '3', isSample: true }],
  },
  {
    title: 'Median of Two Sorted Arrays',
    slug: 'median-two-sorted-arrays',
    statement: 'Given two sorted arrays `nums1` and `nums2`, return the median of the two sorted arrays. The overall run time complexity should be O(log (m+n)).',
    difficulty: 'hard',
    timeLimitSec: 2,
    memoryLimitMB: 128,
    checkerType: 'float',
    testCases: [{ input: '1 3\n2', expectedOutput: '2.00000', isSample: true }],
  },
  {
    title: 'Valid Parentheses',
    slug: 'valid-parentheses',
    statement: 'Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid.',
    difficulty: 'easy',
    timeLimitSec: 1,
    memoryLimitMB: 64,
    checkerType: 'exact',
    testCases: [{ input: '()', expectedOutput: 'true', isSample: true }],
  },
  {
    title: 'Merge K Sorted Lists',
    slug: 'merge-k-sorted-lists',
    statement: 'You are given an array of `k` linked-lists, each sorted in ascending order. Merge all the linked-lists into one sorted linked-list and return it.',
    difficulty: 'hard',
    timeLimitSec: 3,
    memoryLimitMB: 256,
    checkerType: 'exact',
    testCases: [{ input: '[[1,4,5],[1,3,4],[2,6]]', expectedOutput: '[1,1,2,3,4,4,5,6]', isSample: true }],
  },
  {
    title: 'Binary Search',
    slug: 'binary-search',
    statement: 'Given a sorted array of `n` elements and a target value, return the index if the target is found. If not, return -1.',
    difficulty: 'easy',
    timeLimitSec: 1,
    memoryLimitMB: 64,
    checkerType: 'exact',
    testCases: [{ input: '-1 0 3 5 9 12\n9', expectedOutput: '4', isSample: true }],
  },
  {
    title: 'LRU Cache',
    slug: 'lru-cache',
    statement: 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.',
    difficulty: 'medium',
    timeLimitSec: 2,
    memoryLimitMB: 256,
    checkerType: 'exact',
    testCases: [{ input: '2\nput 1 1\nput 2 2\nget 1\nput 3 3\nget 2', expectedOutput: '1\n-1', isSample: true }],
  },
  {
    title: 'Trapping Rain Water',
    slug: 'trapping-rain-water',
    statement: 'Given `n` non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.',
    difficulty: 'hard',
    timeLimitSec: 2,
    memoryLimitMB: 128,
    checkerType: 'exact',
    testCases: [{ input: '0 1 0 2 1 0 1 3 2 1 2 1', expectedOutput: '6', isSample: true }],
  },
  {
    title: 'Climbing Stairs',
    slug: 'climbing-stairs',
    statement: 'You are climbing a staircase. It takes `n` steps to reach the top. Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?',
    difficulty: 'easy',
    timeLimitSec: 1,
    memoryLimitMB: 64,
    checkerType: 'exact',
    testCases: [{ input: '5', expectedOutput: '8', isSample: true }],
  },
];

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[seed] connected');
  let created = 0, skipped = 0;
  for (const p of PROBLEMS) {
    try {
      await Problem.create(p);
      console.log(`  ✅  ${p.title}`);
      created++;
    } catch (err) {
      if (err.code === 11000) { console.log(`  ⚠️   ${p.title} (already exists — skipped)`); skipped++; }
      else throw err;
    }
  }
  console.log(`\n[seed] done — ${created} created, ${skipped} skipped`);
  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });

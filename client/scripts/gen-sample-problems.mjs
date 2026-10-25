#!/usr/bin/env node
// scripts/gen-sample-problems.mjs
// Writes the starter problem set into content/problems/. Run once; the output
// is committed. Re-run to regenerate. Add your own problems as plain .json
// files alongside — this script only (re)writes the ones it owns.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'problems');
mkdirSync(DIR, { recursive: true });

const ALPHA = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''); // ' '..'~'
const rep = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
const tc = (input, expectedOutput, sample = false, label) => ({ input, expectedOutput, sample, ...(label ? { label } : {}) });

const problems = [];

// ── 1. Two Sum ─────────────────────────────────────────────────────────────
problems.push({
  slug: 'two-sum', title: 'Two Sum', difficulty: 'easy', tags: ['array', 'hash map'],
  timeLimitSec: 2, memoryLimitMB: 128,
  statement: `Given an array of \`n\` integers and a target \`t\`, return the **0-based indices** of the two elements that sum to \`t\`. Exactly one such pair exists.

### Input
Line 1: \`n t\`
Line 2: \`n\` space-separated integers

### Output
The two indices in increasing order, space-separated.

### Constraints
- \`2 <= n <= 10^4\`, \`-10^9 <= a[i], t <= 10^9\``,
  testCases: [
    tc('4 9\n2 7 11 15', '0 1', true),
    tc('3 6\n3 2 4', '1 2', true),
    tc('2 6\n3 3', '0 1', true),
    tc('5 8\n1 2 3 4 6', '1 4'),
    tc('6 -8\n-1 -2 -3 -4 -6 0', '1 4'),
    tc((() => { const n = 8000; const a = Array.from({ length: n }, (_, i) => i + 1); return `${n} ${n * 2 - 1}\n${a.join(' ')}`; })(), '7998 7999', false, 'large'),
  ],
});

// ── 2. Valid Parentheses ──────────────────────────────────────────────────
problems.push({
  slug: 'valid-parentheses', title: 'Valid Parentheses', difficulty: 'easy', tags: ['stack', 'string'],
  timeLimitSec: 2, memoryLimitMB: 128,
  statement: `Given a string of \`()[]{}\`, decide whether every bracket is correctly closed in the right order.

### Input
A single line — the string (\`1 <= length <= 10^5\`).

### Output
\`true\` or \`false\`.`,
  testCases: [
    tc('()', 'true', true),
    tc('()[]{}', 'true', true),
    tc('(]', 'false', true),
    tc('([)]', 'false'),
    tc('{[]}', 'true'),
    tc(rep('()', 30000), 'true', false, 'large balanced'),
    tc(rep('(', 30000), 'false', false, 'large unbalanced'),
  ],
});

// ── 3. Binary Search ──────────────────────────────────────────────────────
problems.push({
  slug: 'binary-search', title: 'Binary Search', difficulty: 'easy', tags: ['binary search'],
  timeLimitSec: 2, memoryLimitMB: 128,
  statement: `Given a sorted ascending array and a target, print the index of the target, or \`-1\`.

### Input
Line 1: \`n t\`
Line 2: \`n\` sorted integers

### Output
The index, or \`-1\`.

### Constraints
- \`1 <= n <= 2*10^4\``,
  testCases: [
    tc('6 9\n-1 0 3 5 9 12', '4', true),
    tc('6 2\n-1 0 3 5 9 12', '-1', true),
    tc('1 5\n5', '0', true),
    tc('2 3\n1 3', '1'),
    tc('5 100\n1 2 3 4 5', '-1'),
    tc((() => { const n = 20000; return `${n} 19998\n${Array.from({ length: n }, (_, i) => i * 2).join(' ')}`; })(), '9999', false, 'large'),
  ],
});

// ── 4. Climbing Stairs (1000 tests) ───────────────────────────────────────
// Every n up to 45, the points where the exact answer outgrows 10^9+7 and
// 32/53/64-bit numbers, round and power-of-two sizes, then random n up to 10^5.
// The random part uses a fixed seed, so re-running writes the same file.
const STAIRS_MAX = 100000;
const STAIRS_MOD = 1000000007;
const ways = [1, 1];                                   // ways[n] mod 10^9+7
for (let n = 2; n <= STAIRS_MAX; n++) ways[n] = (ways[n - 1] + ways[n - 2]) % STAIRS_MOD;
const stairs = (n, sample = false, label) => tc(String(n), String(ways[n]), sample, label);

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAIRS_LABELS = {
  44: 'first answer above 10^9+7 — needs the modulo',
  46: 'exact answer overflows a 32-bit int',
  78: 'exact answer passes 2^53 (JavaScript number precision)',
  92: 'exact answer overflows a signed 64-bit int',
  93: 'exact answer overflows an unsigned 64-bit int',
  100000: 'largest n',
};
const STAIRS_FIXED = [46, 47, 50, 64, 77, 78, 79, 90, 91, 92, 93, 94, 100, 127, 128, 255, 256, 500,
  999, 1000, 1001, 1023, 1024, 4096, 9999, 10000, 10001, 32767, 32768, 50000, 65535, 65536, 65537,
  99998, 99999, 100000];
const stairsCases = [stairs(2, true), stairs(3, true), stairs(1, true)];
for (let n = 4; n <= 45; n++) stairsCases.push(stairs(n, false, STAIRS_LABELS[n]));
for (const n of STAIRS_FIXED) stairsCases.push(stairs(n, false, STAIRS_LABELS[n]));
const usedN = new Set(stairsCases.map((c) => Number(c.input)));
const rand = mulberry32(20261025);
while (stairsCases.length < 1000) {
  const n = rand() < 0.2 ? 46 + Math.floor(rand() * 955) : 1001 + Math.floor(rand() * (STAIRS_MAX - 1001));
  if (usedN.has(n)) continue;
  usedN.add(n);
  stairsCases.push(stairs(n));
}

problems.push({
  slug: 'climbing-stairs', title: 'Climbing Stairs', difficulty: 'easy', tags: ['dp', 'math'],
  timeLimitSec: 2, memoryLimitMB: 64,
  statement: `You climb a staircase of \`n\` steps, taking 1 or 2 steps at a time. How many distinct ways are there to reach the top?

The answer grows very fast, so print it **modulo 1 000 000 007** (\`10^9 + 7\`).

### Input
A single integer \`n\` (\`1 <= n <= 10^5\`).

### Output
The number of ways, modulo \`10^9 + 7\`.

### Notes
- \`n = 3\` has 3 ways: 1+1+1, 1+2 and 2+1.
- The exact answer passes \`10^9 + 7\` at \`n = 44\`, overflows a 64-bit integer at \`n = 92\` and has about 20 900 digits at \`n = 10^5\`, so keep the numbers small by taking the modulo at every step.
- Plain recursion is exponential and runs out of time. Memoized recursion goes \`n\` calls deep, which can overflow the stack for large \`n\`; a loop is the safe choice.
- There are 1000 test cases: every \`n\` up to 45, the overflow boundaries above, and random \`n\` up to \`10^5\`.`,
  testCases: stairsCases,
});

// ── 5. Maximum Subarray ───────────────────────────────────────────────────
problems.push({
  slug: 'maximum-subarray', title: 'Maximum Subarray', difficulty: 'medium', tags: ['dp', 'array'],
  timeLimitSec: 2, memoryLimitMB: 128,
  statement: `Find the largest possible sum of a **contiguous** non-empty subarray.

### Input
Line 1: \`n\`
Line 2: \`n\` integers

### Output
The maximum subarray sum.

### Constraints
- \`1 <= n <= 2*10^5\`, \`-10^4 <= a[i] <= 10^4\`
- An **O(n²)** solution will TLE on the large test.`,
  testCases: [
    tc('9\n-2 1 -3 4 -1 2 1 -5 4', '6', true),
    tc('1\n1', '1', true),
    tc('5\n-1 -2 -3 -4 -5', '-1', true),
    tc('4\n5 4 -1 7 8', '23'),
    tc((() => { const n = 40000; const a = Array.from({ length: n }, (_, i) => (i % 7) - 3); return `${n}\n${a.join(' ')}`; })(), '6', false, 'large — kills O(n^2)'),
  ],
});

// ── 6. Longest Substring Without Repeating Characters (with TLE/MLE traps) ──
problems.push({
  slug: 'longest-substring-without-repeating-characters',
  title: 'Longest Substring Without Repeating Characters',
  difficulty: 'medium', tags: ['sliding window', 'string'],
  timeLimitSec: 3, memoryLimitMB: 128,
  statement: `Return the length of the longest substring of \`s\` with no repeating characters.

### Input
A single line — the string \`s\`. It may be empty and may contain spaces, so read the **whole line** (do not trim).

### Output
A single integer.

### Constraints
- \`0 <= |s| <= 6*10^4\`, printable ASCII (\`' '\`..\`'~'\`).
- **O(n)** sliding window passes easily. An **O(n²)** solution TLEs; an
  **O(n²)-space** interval DP MLEs (in the browser this shows as RE for
  JavaScript, MLE for Python / C++ / Java).`,
  testCases: [
    tc('abcabcbb', '3', true),
    tc('bbbbb', '1', true),
    tc('pwwkew', '3', true),
    tc('\n', '0', true, 'empty string'),
    tc(' ', '1', true, 'single space (a .strip() bug fails)'),
    tc('abba', '2', false, 'left pointer must not move back'),
    tc('tmmzuxt', '5'),
    tc(ALPHA, '95', false, 'every printable ASCII once'),
    tc(rep('a', 60000), '1', false, 'TLE trap — O(n^2) double loop'),
    tc(rep(ALPHA, 60000), '95', false, 'TLE trap — O(n^2*k) set rebuild'),
    tc(rep('a', 30000), '1', false, 'MLE trap — O(n^2) space table'),
  ],
});

for (const p of problems) {
  writeFileSync(join(DIR, `${p.slug}.json`), JSON.stringify(p, null, 2) + '\n');
}
console.log(`[gen] wrote ${problems.length} problems to content/problems/`);

'use strict';

// ── Seed: LeetCode #3 — Longest Substring Without Repeating Characters ───────
//   node server/seed_lc3.js       (idempotent — upserts by slug)
//
// PRACTICE-mode problem → JS / Python submissions are judged IN THE BROWSER
// (C/C++/Java practice falls back to the server judge). All test cases are
// public; `isSample:true` = the "Run Samples" quick-check set, `isSample:false`
// = the rest of the "Judge in Browser" set. The last three are perf traps.
//
// Tuning (timeLimitSec 3 · memoryLimitMB 128):
//   O(n) last-seen map           → fast, small                    → AC
//   O(n·alphabet) "restart"      → ~1-2 s on 2·10⁵                → AC (tolerated)
//   O(n²) / O(n²·k) time         → 10⁹-10¹⁰ ops on 2·10⁵          → TLE (browser Worker terminated at the limit)
//   O(n²) space (n×n table)      → huge allocation on 4·10⁴       → RE in the browser (a tab can't measure memory → not MLE);
//                                                                   MLE only if this problem is judged server-side (contest mode)
//
// Want real server-side MLE verdicts + hidden test cases? Change `mode` to
// 'contest' below (or in the admin problem editor) and add it to a contest.

require('dotenv').config();
const mongoose = require('mongoose');
const Problem = require('./src/models/Problem');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/codeforge';

const ALPHABET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(''); // space..~
const rep = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);

const RUN_CASES = [
  { input: 'abcabcbb',       expectedOutput: '3' },
  { input: 'bbbbb',          expectedOutput: '1' },
  { input: 'pwwkew',         expectedOutput: '3' },
  { input: '\n',             expectedOutput: '0', label: 'empty string' },
  { input: ' ',              expectedOutput: '1', label: 'single space (a .strip() bug fails here)' },
  { input: 'au',             expectedOutput: '2' },
  { input: 'dvdf',           expectedOutput: '3' },
].map((tc) => ({ ...tc, isSample: true }));

const SUBMIT_CASES = [
  // correctness — the window's left pointer must never move backwards
  { input: 'abba',            expectedOutput: '2',  pretest: true, label: 'left-pointer regression' },
  { input: 'tmmzuxt',         expectedOutput: '5',  pretest: true, label: 'left-pointer regression' },
  { input: 'abcabcbbabcdefg', expectedOutput: '7',  pretest: true },
  { input: '!@#$%^&*()_+',    expectedOutput: '12', pretest: true, label: 'symbols' },
  { input: '0123456789',      expectedOutput: '10', pretest: true, label: 'digits' },
  { input: 'abcdefghijklmnopqrstuvwxyz'.repeat(3), expectedOutput: '26', label: 'periodic, full lowercase cycle' },
  { input: rep('abcde', 4000), expectedOutput: '5', label: 'periodic, 2·10⁴ chars' },
  { input: ALPHABET,          expectedOutput: '95', label: 'every printable ASCII once' },

  // ── TLE traps ──────────────────────────────────────────────────────────
  { input: rep('a', 200000),      expectedOutput: '1',
    label: 'TLE trap — 2·10⁵ identical chars; any O(n²) double loop / substring slicer times out' },
  { input: rep(ALPHABET, 200000), expectedOutput: '95',
    label: 'TLE trap — 2·10⁵ chars, 95-wide unique windows; kills O(n·k) set-rebuild-per-step' },

  // ── MLE trap ───────────────────────────────────────────────────────────
  { input: rep('a', 40000),       expectedOutput: '1',
    label: 'MLE trap — 4·10⁴ chars; an O(n²)-space interval DP allocates ~13 GB → OOM' },
].map((tc) => ({ ...tc, isSample: false }));

const STATEMENT = `Given a string \`s\`, return the length of the **longest substring** that contains no repeating characters.

A *substring* is a contiguous run of characters. "Longest substring without repeating characters" of \`"abcabcbb"\` is \`"abc"\`, so the answer is \`3\`.

### Input

A single line — the string \`s\`. It may be empty, and it may contain spaces, so read the **entire line** (e.g. \`sys.stdin.readline().rstrip("\\n")\`, \`getline(cin, s)\`, \`fs.readFileSync(0,"utf8").replace(/\\n$/,"")\`). Do **not** \`.trim()\` / \`.strip()\` — leading/trailing spaces are part of \`s\`.

### Output

A single integer — the length of the longest substring of \`s\` with all distinct characters.

### Constraints

- \`0 <= s.length <= 2 * 10^5\`
- \`s\` consists of printable ASCII characters (\`' '\` (0x20) through \`'~'\` (0x7E)).

### Examples

| Input | Output | Why |
|---|---|---|
| \`abcabcbb\` | \`3\` | \`"abc"\` |
| \`bbbbb\` | \`1\` | \`"b"\` |
| \`pwwkew\` | \`3\` | \`"wke"\` (\`"pwke"\` is a *subsequence*, not a substring) |
| \`abba\` | \`2\` | \`"ab"\` then \`"ba"\` — the left edge only moves forward |

> An **O(n)** sliding window passes comfortably. An **O(n²)** solution will TLE on the
> large tests, and an **O(n²)-space** interval-DP will MLE.`;

const PROBLEM = {
  title: 'Longest Substring Without Repeating Characters',
  slug: 'longest-substring-without-repeating-characters',
  statement: STATEMENT,
  difficulty: 'medium',
  mode: 'practice',        // JS/Python → judged in the browser; C/C++/Java → server
  timeLimitSec: 3,
  memoryLimitMB: 128,
  checkerType: 'exact',
  constraints: { n: '0 <= |s| <= 2·10^5', charset: "printable ASCII, ' '..'~'" },
  testCases: [...RUN_CASES, ...SUBMIT_CASES],
};

const SOLUTIONS = {
  'AC (Python, O(n))': `import sys
s = sys.stdin.readline().rstrip("\\n")
last = {}
left = ans = 0
for i, c in enumerate(s):
    if c in last and last[c] >= left:
        left = last[c] + 1
    last[c] = i
    ans = max(ans, i - left + 1)
print(ans)`,
  'TLE (Python, O(n^2) double loop)': `import sys
s = sys.stdin.readline().rstrip("\\n")
n = len(s); ans = 0
for i in range(n):
    seen = set()
    for j in range(i, n):
        if s[j] in seen:      # a smarter break still leaves the outer loop O(n^2) on the traps
            break
        seen.add(s[j])
    ans = max(ans, len(seen))
# the substring-slicing variant  max(len(set(s[i:j])) ... )  is even slower (O(n^3))
print(ans)`,
  'MLE (Python, correct answer but O(n^2) memory)': `import sys
s = sys.stdin.readline().rstrip("\\n")
n = len(s)
_table = [[0] * n for _ in range(n)]   # the memory bomb: ~n^2 refs, OOMs on the big cases
last = {}
left = ans = 0
for i, c in enumerate(s):              # otherwise a correct O(n) sliding window
    if c in last and last[c] >= left:
        left = last[c] + 1
    last[c] = i
    ans = max(ans, i - left + 1)
print(ans)`,
};

async function main() {
  await mongoose.connect(MONGO_URI);
  const p = await Problem.findOneAndUpdate(
    { slug: PROBLEM.slug },
    { $set: PROBLEM },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const run = p.testCases.filter((t) => t.isSample).length;
  const sub = p.testCases.filter((t) => !t.isSample).length;
  const where = p.mode === 'practice' ? 'in the browser (JS/Python) / server (C/C++/Java)' : 'server only';
  console.log(`[seed] "${p.title}"  ${p._id}`);
  console.log(`       ${run} "Run Samples" cases · ${sub} more "Judge" cases · time ${p.timeLimitSec}s · mem ${p.memoryLimitMB}MB · mode ${p.mode}`);
  console.log(`       judged: ${where}`);
  console.log(`       perf traps at case #${run + sub - 2} and #${run + sub - 1} (TLE) · #${run + sub} (server MLE / browser RE)`);
  console.log('\n── Paste these into the editor to verify verdicts ─────────────────────');
  for (const [name, code] of Object.entries(SOLUTIONS)) {
    console.log(`\n# ${name}\n${code}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

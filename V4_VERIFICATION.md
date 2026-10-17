# v4 verification — run this on your machine

The v4 rebuild (Phases 0–6) is code-complete. Unit suites pass here (81 server +
5 client); everything that needs Docker / Mongo / Redis must be verified on your
box. Spec: `codeforge-arena-v4.md`. Deviations: `FINDINGS.md`.

## 0. Bring it up

```bash
docker compose up -d --build          # builds codeforge/fat-judge (+ supervisor), starts mongo + redis
npm install
npm test                              # 81 server + 5 client unit tests, no infra
npm run test:integration              # judge matrix + leaderboard — needs the stack up
node server/seed_problems.js && node server/updateAllProblems.js
npm run dev                           # server :5000, client :5173
```

Register a user, then `node server/makeAdmin.js`, log out/in.

## 1. Execution engine (Phase 2)

`npm run test:integration` covers AC/WA/TLE/MLE/CE/RE + Java-text-block-near-limit.
Then manually:

```bash
docker run --rm codeforge/fat-judge:latest cat /sys/fs/cgroup/memory.events   # "oom_kill 0", not an error
```

- submit an infinite loop → **TLE**, each case ≈ the limit (not the sum)
- submit a big `malloc` loop (limit 128 MB) → **MLE**, not TLE, not RE
- while a slow submission judges: `docker ps --filter name=judge- -q | head -1 | xargs docker rm -f`
  → submission ends **status `ERROR`** (not RE); Admin → Submission Monitor shows `ERROR`
- a few seconds after the queue drains: `docker ps -a --filter name=judge-` is **empty** (no leak)
- `Ctrl-C` the server mid-judge → finishes the job, then no `judge-*` containers remain

## 2. Private test cases never leak (Phase 3)

Create a **contest**-mode problem with 1 sample + 2 hidden cases. As a non-admin:

- `GET /api/v1/problems/:id` → response `testCases` has **only the sample**
- submit a wrong solution → `GET /api/v1/submissions/:id` → `failedTestCase` is
  `{}` (or the sample's data if it failed the sample); `testResults` has per-case
  verdict + timing but **no input/expected/actual** for hidden cases
- the SSE stream shows the same

## 3. Contest leaderboard (Phase 3)

- Admin → **New Contest**, pick the problem, set a live window
- two users submit (mix of WA then AC) via `/problems/:id?contestId=<id>`
- `/contests/:id` standings: order = (solved desc, penalty asc); penalty =
  minutes-from-start + 20 per pre-AC reject; matches hand calculation
- re-submit the same AC twice fast → solved count does **not** double
- Admin → **Contests** → *Rebuild standings* → identical result

## 4. In-browser practice judge + client-side TLE / MLE (Phase 4)

`node server/seed_lc3.js` makes a **practice** problem "Longest Substring…"
(3 s / 128 MB). Open it in **Python**, Network tab open:

- **"Judge in Browser"** runs every case locally — **no** `/api/v1/submissions`
  call, no extra test-case fetch. First run downloads Pyodide once (~10 MB).
- **AC** — the O(n) sliding-window solution → `AC`, ✓ badge on the problem list.
- **TLE** — the O(n²·k) set-rebuild solution (seed prints it) → `TLE` on case
  #16 or #17, Worker terminated at ~3 s.
- **MLE** — the memory-bomb solution (`_table = [[0]*n for _ in range(n)]`, seed
  prints it) → `MLE`: Pyodide's WASM heap tries to grow past ~2 GB → `MemoryError`
  → MLE verdict, with the peak MB shown per case.
- JavaScript: same, but MLE is best-effort (`MLE` on Chromium via
  `performance.memory`; may show `RE` on Firefox/Safari — that's expected).
- A **C++/Java** practice problem still shows "Submit for Verdict" → server judge.

## 5. Special checker (Phase 5)

Admin → **New Problem** → checker `special`, language C++, source e.g.:

```cpp
#include <bits/stdc++.h>
int main(int c,char**v){std::ifstream o(v[2]),e(v[3]);std::string a,b;
 long long x,y;o>>x;e>>y;return std::llabs(x-y)<=1?0:1;}
```

Submit a solution off-by-one from expected → **AC** (checker tolerates ±1);
off-by-two → **WA**.

---

Report which sections pass. Anything red is a v4 bug to fix before sign-off.

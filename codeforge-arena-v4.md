# CodeForge Arena — Architecture v4

v3 was implemented, reviewed hard, and found to have design-level gaps (a reused
sandbox pool, no per-test-case limits, non-deterministic MLE, no scaling story)
and ~25 implementation slips (an IDOR, a `GET /problems/:id` that returned every
hidden test case, contest scoring that never worked from the UI). v4 keeps the
*idea* and rebuilds the parts that didn't hold. v3 (`codeforge-arena-v3-hardened.md`)
is kept for history; **v4 is the spec.**

Deviations from v3 and the reasoning behind each are recorded in `FINDINGS.md`.

---

## 1. The idea (unchanged)

- **Practice problems** — every test case is public. Judged **in the browser**;
  the user sees every case and the failing one. Zero server compute. A spoofed
  "solved" is harmless (no leaderboard).
- **Contest problems** — test cases are split public + private.
  - Public cases run **client-side during the contest** for instant feedback; a
    failing public case is shown.
  - Private cases run **server-side only**; their content never leaves the
    server. A private failure tells the user *which case* and *the verdict* —
    never the data.
  - The **authoritative verdict** is always the server's run.

## 2. Trust model

| Actor | Trusted for | Not trusted for |
|---|---|---|
| Browser — practice | nothing that matters | any authoritative claim |
| Browser — contest public tests | instant feedback | verdict, timing, standings |
| Server judge — contest | verdict, timing, standings | — |
| Private test data | Mongo + the ephemeral sandbox only | never in an HTTP/SSE response to a non-admin, never in a Redis job payload |

Explicitly **not protected** (by design): a determined user can fake a practice
"solved" marker. An async server spot-check is a documented future option.

## 3. Execution engine — ephemeral, per-test-case

- **One fresh container per submission.** `judge/sandbox.js`: `acquireSandbox()`
  (warm buffer of pre-created, single-use containers) → judge → `destroySandbox()`.
  No pool reuse, no `RECYCLE_AFTER_N`, no per-container counters. The worker is
  stateless — scale by adding worker processes/machines.
- Hardening: `--network=none --cap-drop=ALL --security-opt=no-new-privileges
  --read-only`, tmpfs `/dev/shm` at 1 KB `noexec`, tmpfs `/workspace`,
  `--pids-limit`, a generous container `--memory` (host protection only), and
  `--runtime=runsc` (gVisor) when the daemon offers it.
- **In-container supervisor** (`judge/supervisor.py`, `compile` / `run` / `check`
  modes). For **each** test case, in its own child process / process group:
  - its own `timeout` (TLE = killed for time, or finished over the limit);
  - peak RSS from the kernel's `/proc/<pid>/status:VmHWM`;
  - **MLE is deterministic**: `memory.events:oom_kill` delta > 0, or
    `peak > limit + slack` (slack: 64 MB for the JVM's metaspace/JIT, 8 MB
    otherwise). No `ulimit -v`, so Java is judged on real RSS.
  - output cap (OLE), first-fail short-circuit for pretests.
- `judge/verdict.js` — pure function: `(compile, run, problem) → verdict +
  per-case `testResults` + `runtimeMs`/`memoryMB` + (server-shaped) failing case`.
  An `AC` that didn't run every intended case, or a checker that can't judge,
  throws → the submission goes to **status `ERROR`**, never a contestant verdict.

## 4. Submission state machine

```
status:  QUEUED → COMPILING → RUNNING → DONE      (verdict set)
                                      ↘ ERROR     (verdict null, error set)
verdict: AC | WA | TLE | MLE | RE | CE            (null until DONE)
```

Idempotency key is namespaced `${userId}:${key}`. `GET /submissions/:id` and the
SSE stream are owner-or-admin only. SSE **catches up**: if the submission is
already terminal on connect, the verdict is emitted immediately.

## 5. Contests

- `Problem.mode` (`practice` | `contest`); test cases carry `isSample` and
  `pretest`. `GET /problems/:id` returns only `isSample` cases to non-admins in
  contest mode.
- Client threads `?contestId=` → submit body → `contestEligibility` (time window
  + problem set + participation for private contests; demotes silently, never
  rejects).
- **Pretests / system tests**: during the contest window a problem with `pretest`
  cases is judged on `sample + pretest` only (`provisional`). `POST
  /contests/:id/system-test` re-judges every provisional on the full set;
  `POST /contests/:id/rebuild-standings` recomputes the board from Mongo.
- **Leaderboard** (`src/leaderboard.js`): ICPC — rank by (solved desc, penalty
  asc), penalty per solved problem = minutes-from-start at first AC + 20 ×
  rejected-before-AC (CE is free). Encoded in one ZSET score
  `solved × 1e7 − penalty`. Incremental updates use an **atomic Lua script**
  (kills the check-then-increment double-count race); `rebuildContest` from Mongo
  is the source of truth after system tests. `GET /leaderboard[?contestId=]`.

## 6. Client practice judge (`client/src/judge/`)

| Language | Mechanism |
|---|---|
| JavaScript | throwaway Web Worker; `readline()` / `fs.readFileSync(0)` / `process.stdin` shims mimic `node solution.js` |
| Python | persistent Pyodide worker (real CPython → WASM); CDN-loaded, local-vendoring path documented |
| C / C++ / Java | **server judge** (the v4 engine) for now — a full in-browser toolchain (wasi-sdk compile-service + WASI shim, or CheerpJ) is a documented follow-up |

`checker.js` is a line-for-line port of the server's `exact` / `float` checkers
(client tests assert parity).

**In-browser resource verdicts** (the project's novelty — see FINDINGS F22):
- **TLE** — wall-clock; the run's Worker is terminated at the limit.
- **MLE (Python)** — real: Pyodide's heap is one `WebAssembly.Memory` that only
  grows, so `byteLength − post-init size` is the true peak allocation; over the
  limit (or a `MemoryError`) → MLE.
- **MLE (JavaScript)** — best-effort: `performance.memory` delta (Chromium), a
  caught allocation error, or a Worker OOM-death. Degrades to RE where
  `performance.memory` is unavailable.

Non-authoritative by design — the server judge (contest mode) is the source of
truth — but accurate enough that practice feedback is meaningful.

## 7. Checkers

- `exact` — CRLF-normalised, trailing-whitespace / trailing-blank-line
  insensitive, otherwise byte-exact.
- `float` — token-wise, `|a−e| ≤ max(1e-9, 1e-6·|e|)`.
- `special` — a custom program (`c`/`cpp`/`python`/`javascript`) compiled and run
  in its own sandbox: `<checker> input output expected`, exit 0 = AC, non-zero =
  WA, stdout = message.

## 8. Config, ops, tests

- All env in `src/config.js` — production boot **fails fast** on a weak/missing
  `JWT_SECRET` or an unpinned/placeholder judge image.
- Shared Redis clients (`src/redis.js`); graceful shutdown drains the in-flight
  job and destroys sandboxes; startup reaps orphan `judge-*` containers.
- `npm test` — unit suites, no infra. `npm run test:integration` — needs the
  compose stack (judge matrix + leaderboard).

## 9. Deferred (named, not hidden)

- **Full in-browser C/C++/Java practice** — needs a WASM toolchain + real-browser
  testing. Server judge covers these today.
- **Cross-origin isolation (COOP/COEP)** — would break CDN Pyodide/Monaco; enable
  after everything is vendored.
- **Docker-socket trust boundary** — the worker talks to the daemon (host-root
  equivalent). Mount the socket only into the worker process; gVisor narrows the
  guest. Full rootless / VM isolation is out of scope for a single-box install.
- **Multi-node autoscaling** — the pieces are in place (stateless workers,
  queue-depth signal); a scaler (KEDA or similar) is an ops task, not code.

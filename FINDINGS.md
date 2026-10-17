# FINDINGS — where reality contradicted the v3 spec

Recorded during the v3 → v4 rebuild. Each entry: what v3 said, what was wrong,
what v4 does. The v4 spec is `codeforge-arena-v4.md`.

## Design-level

### F1. The persistent container pool is the wrong primitive for untrusted code
v3 §2 chose a health-checked, reused pool over ephemeral containers, "named
trade-off — lower latency … at the cost of relying on cleanup+recycling
discipline." Reusing a container across submissions from *different contestants*
is a contamination and side-channel risk that `pkill` + `rm -rf /workspace/*`
(a blocklist) cannot close. Every serious judge uses single-use isolation.
**v4:** one fresh container per submission, destroyed after. The
`RECYCLE_AFTER_N` / resource-ceiling-respawn machinery existed only to paper over
reuse and is gone.

### F2. "concurrency: 4 / min:4 max:4" baked a single-box assumption into the design
Pool size, worker concurrency, and the per-container counter map were all
in-process. **v4:** stateless worker (`create → judge → destroy`), everything
configurable, coordination in Redis/the queue. Throughput = workers × concurrency.

### F3. Per-test-case time limits were never specified, so the impl lost them
v3 §3 shows a single `runCmd` under one `timeout ${problem.timeLimitSec}s`; the
multi-case model was unspecified and the implementation collapsed N cases into
one `timeout` of `ceil(timeLimitSec × caseCount)`. A solution 5–40 % over the
limit *per case* could still pass. **v4:** the supervisor runs **each case** under
its own timeout; TLE if any single case is over.

### F4. MLE detection was a timing heuristic the doc itself distrusted
v3 §3: "killed within 200 ms of the time limit → TLE else MLE … worth wiring up
[the cgroup oom counter] before you trust MLE verdicts at scale." With the
batched timeout the heuristic compared against the wrong number and effectively
never produced MLE. **v4:** deterministic — cgroup `memory.events:oom_kill` delta,
plus `peak RSS > limit + slack`. `ulimit -v` is gone everywhere (it was the JVM
false-MLE cause).

### F5. The BullMQ lock math became meaningless
`LOCK_DURATION_MS = (MAX_TIME + COMPILE + margin)` assumed the run *was*
`problem.timeLimitSec`. With per-case runs bounded by `MAX_ALLOWED_TIME_LIMIT_SEC`
the assumption holds again; **v4** sets a moderate 120 s lock and documents the
reliance on BullMQ's own lock renewal for long system-test passes, plus a
per-job wall-clock guard in the worker.

### F6. The contest layer never worked end-to-end
The UI never sent `contestId`; `contestEligibility` therefore always demoted to
practice; `<Leaderboard contestId>` ignored the prop and showed the global board;
penalty rendered a literal `--`; the worker's `zincrby`-per-AC had a
check-then-act race. **v4:** `contestId` threaded URL → body → eligibility;
ICPC penalty model; atomic Lua update; Mongo rebuild as source of truth;
`GET /leaderboard?contestId=`; frontend wired.

### F7. SSE had a designed-in race
Redis Pub/Sub is fire-and-forget; a client connecting after the verdict was
published waited out the 60 s timeout. **v4:** the SSE route checks the DB for a
terminal state on connect and emits it immediately.

## Security / correctness slips

### F8. IDOR — any authenticated user could read any submission
`GET /submissions/:id` had no ownership check; the idempotency key was used
directly as the Mongo `_id`, so a replayed key returned someone else's
submission. **v4:** owner-or-admin gate on the REST route and the SSE stream;
key namespaced `${userId}:${key}`.

### F9. `GET /problems/:id` returned every hidden test case
The detail route returned the full problem, `testCases` included. **v4:**
`visibleTestCases` — non-admins get only `isSample` cases in contest mode;
`enqueueSubmission` also stopped forwarding the problem doc into the Redis job.

### F10. Default JWT secret, silently
`process.env.JWT_SECRET || 'dev_secret_change_me'` with no warning. **v4:**
`config.js` fails a production boot on a missing/weak secret, warns in dev.

### F11. Status enum vs. what the code wrote
The model enum listed verdict values as `status`; the worker wrote
`status: 'COMPLETED'` / `'FAILED'` (not in the enum — only survived because
`findByIdAndUpdate` skips validators). **v4:** `status ∈ {QUEUED, COMPILING,
RUNNING, DONE, ERROR}`, `verdict` separate and nullable, `error` for infra —
threaded through model, worker, publisher, SSE, and the client.

### F12. Infra failure during the run was misclassified as RE
`runSubmission` caught everything from the exec and mapped it to RE/TLE/MLE — a
container that died mid-run gave the contestant a Runtime Error. **v4:**
supervisor/sandbox faults raise `SandboxError`/`JudgeInfraError` → status
`ERROR`.

### F13. `memoryMB` was hardcoded to 0; `testResults[]` never populated
The schema and `SubmissionPanel` were built for per-case results the worker never
wrote. **v4:** both populated from the supervisor.

### F14. `exact` checker didn't normalise CRLF
An admin pasting expected output from Windows caused spurious WA. **v4:** `\r\n`
→ `\n` before compare.

### F15. Pool leak on cleanup failure
`cleanupContainer` throwing meant `pool.release` never ran — the slot leaked.
Moot under ephemeral (always `docker rm -f` in `finally`), but the acquire/finally
is now bulletproof regardless.

### F16. No auth rate limiting
`/auth/login` allowed unlimited guessing. **v4:** IP-keyed limiter (20 / 5 min).

## Environment

### F17. OpenJDK 17, not 21
`judge/Dockerfile` header said "OpenJDK 21" but installed 17. **v4:** stays on
17 (LTS; text blocks are Java 15+, records 16, sealed classes 17 — nothing the
judge needs is newer) and the comment is corrected. Bumping Debian bookworm to
21 needs backports and hurts reproducibility; not worth it.

### F18. `.env.example` was inaccurate
Advertised `REDIS_HOST`/`REDIS_PORT` (unused; code reads `REDIS_URL`) with the
wrong port, and shipped the `<pinned-digest>` placeholder that made the pool fail
to spawn. **v4:** rewritten to match `config.js` exactly.

### F19. `test_*.js` scripts weren't a runnable suite
~19 ad-hoc scripts, most needing infra, one red, no `npm test`. **v4:**
`node --test` with unit / integration split; legacy scripts moved to
`test/legacy/` for reference.

## v4 deviations from its own plan

### F20. Full in-browser C/C++/Java practice judge — not shipped
The v4 plan called for a WASI compile-service + in-browser execution for C/C++
and CheerpJ for Java. Building it needs toolchain assets that couldn't be fetched
during implementation and a real browser to verify. **Shipped:** JS + Python
judged fully in-browser; C/C++/Java practice uses the (now correct, fast) server
judge. Every language works; the scaling win is real for the JS/Python share of
practice traffic. Full client-side C/C++/Java remains a documented follow-up.

### F21. Cross-origin isolation (COOP/COEP) — deferred
Would break CDN-loaded Pyodide and Monaco. Enable once those are vendored
locally; not needed for non-threaded Pyodide.

### F22. In-browser TLE / MLE verdicts — added (the project's novelty)
The owner's core requirement: the in-browser practice judge must produce **TLE
and MLE verdicts**, not just AC/WA/RE.

- **TLE** — wall-clock: the run's Web Worker is `terminate()`d at
  `timeLimit + margin`; a run that finishes over the limit is also TLE.
  Approximate (wall time, machine-load sensitive) but reliable for catching a
  genuinely quadratic solution.
- **MLE — Python (Pyodide): real.** Pyodide's entire heap is one
  `WebAssembly.Memory` that only ever grows, so
  `wasmMemory.buffer.byteLength − (size right after init)` is the true peak the
  solution forced to be allocated. Exceeding `memoryLimitMB` (+8 MB slack), or a
  Python `MemoryError` (grow refused), → MLE. `gc.collect()` between cases lets
  freed pages be reused so per-case attribution stays meaningful.
- **MLE — JavaScript: best-effort.** `performance.memory.usedJSHeapSize` delta
  (Chromium only), a caught allocation error, or the Worker dying on a short run
  (V8 OOM). Firefox / Safari have no `performance.memory`, so there JS MLE
  degrades to RE. A page fundamentally cannot hard-cap a Worker's heap.

The server judge (contest mode, C/C++/Java) stays authoritative. The client
verdict is labelled "judged in this browser (not an official verdict)".

---

## Static-PWA rebuild (all 5 languages judged client-side, no server)

Owner decision: drop the deployed server entirely. Practice = 100% in-browser for
JavaScript, Python, C, C++ and Java. `server/` kept for a future contest mode,
not deployed. Hosting: Cloudflare Pages, $0, ≤10k users.

### F23. Pyodide `setStdin({stdin: () => str})` truncates at ~8 KiB
The high-level string-callback stdin only ever delivered its first read buffer
(8192 bytes) with `autoEOF` on, so any problem with a large test case silently
returned WA. **Fix:** the low-level `setStdin({ read: (u8) => nBytes })` byte
interface — re-invoked until EOF, delivers the whole input. (`runners/python.js`)

### F24. F21 reversed — cross-origin isolation is now ON
emception cannot pass stdin to a compiled C/C++ program without
`SharedArrayBuffer`, so COOP/COEP had to be enabled after all. F21's worry was
unfounded: jsDelivr **and** `cjrtnc.leaningtech.com` send
`Cross-Origin-Resource-Policy: cross-origin` on every asset, so Pyodide, Monaco
and CheerpJ all still load under COEP. Verified: `crossOriginIsolated === true`
with Python judging still AC and Monaco still rendering. (`vite.config.js`,
`public/_headers`, `public/sw.js` re-applies to same-origin responses.)

### F25. C/C++ = emception 4.x, not the 0.0.9 guess in the old cpp.js
`emception@0.0.9` never existed. Current is `@gameguild/emception-browser@4.4.0`
(npm glue) + `emception@4.4.0/cdn/*` (Brotli WASM payload, fetched from jsDelivr).
Headless API: `createEmception({tty:'none'})` → `em.run('clang'|'wasm-ld'|'wasi-run', argv, {stdin, onStdout})`.
Runs **without** cross-origin isolation for compile+stdout; needs it for stdin.
Vite notes: the package ships `./subprocess_shim.py?raw` and
`new Worker(new URL('./worker-entry', import.meta.url))` — the esbuild/rolldown
dep pre-bundler chokes on the `?raw` (Windows "os error 123"), so the three
`@gameguild/*` + `emception` packages go in `optimizeDeps.exclude`.

### F26. emception `wasi-run` stdin is one byte per `fd_read` syscall
Its minimal WASI runtime hard-codes `out[0] = byte; return 1` in `fd_read`, and
each call crosses the Asyncify boundary (~10 µs). A correct C/C++ solution TLEs
on ~10⁵+ input tokens purely on I/O (Binary Search's n=20000 case: 3 s). No fix
within emception; the real fix is to run the linked `main.wasm` in a
hand-written WASI worker with bulk `fd_read`. Documented as a known limit; keep
C/C++ problem inputs modest. C/C++ compile is memoised per submission so only
case 1 pays the ~15–30 s compile.

### F27. Java = CheerpJ 4.3, and it will not boot in the dev sandbox browser
`cheerpjRunMain` never resolves in the sandboxed preview browser (same for
CheerpJ 3.0 earlier). It works in real Chrome — proven by Leaning Technologies'
own JavaFiddle, whose pattern `runners/java.js` copies: loader
`cjrtnc.leaningtech.com/4.3/loader.js`, `cheerpjInit({status:'none'})`,
`com.sun.tools.javac.Main.compile(argv, writer)` for capturable diagnostics,
`System.setIn/Out/Err` redirection to `/files/` inside an embedded `CFJudge`
helper (base64 Java-8 bytecode), read back with `cjFileBlob`. **Java is
code-complete but browser-unverified — run VERIFY.md §4 in real Chrome.**
Licence: CheerpJ is free for educational/non-commercial use, which the owner
confirmed fits (college project, no fees).

### F28. C/C++/Java runners are code-split
`judge/index.js` dynamic-`import()`s `runners/cpp.js` (351 KB) and
`runners/java.js` (9 KB) only when that language is picked. Base bundle stays
274 KB / 88 KB gzip — a JS/Python-only visitor downloads none of the compiler
glue. "Toolchain unavailable" errors carry `name === 'ToolchainUnavailable'` so
the dispatcher recognises them without importing the class.

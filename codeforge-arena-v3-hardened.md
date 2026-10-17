# CodeForge Arena — Architecture v3 (Hardened)

v2 was reviewed hard and three of its nine fixes either didn't do what they claimed or introduced new correctness risk. This revision replaces the mechanism, not just the flag, everywhere that was true. Still 4 containers, still one laptop — the pool now manages them by rotating identity instead of fixed names, which is what makes the health-check/respawn logic possible.

---

## 🏛 Core Axiom (unchanged)

The client may execute code via WASM for instant sample-test feedback, but it may never be the source of a verdict, timing, or standings. Every authoritative verdict comes from a sandboxed server-side worker.

A corollary made explicit in this revision: **a resource-limiting mechanism that produces false verdicts violates the axiom just as much as a missing sandbox does.** That's the reasoning behind the memory-limiting rewrite below.

---

## What changed from v2

| Issue | Why v2's fix didn't hold | v3 fix |
|---|---|---|
| `--shm-size=0` | Docker requires the value to be `> 0` — this flag either errors or silently no-ops to the 64m default | `--tmpfs /dev/shm:...,size=1k` — overrides the default mount with a 1KB, `noexec`, `nosuid`, `nodev` tmpfs. Valid syntax, functionally closes the vector. |
| `ulimit -v` for memory | Bounds virtual address space, not RSS. JVM reserves virtual space (metaspace, code cache, per-thread stacks) far beyond actual usage → false MLE on correct Java submissions | Per-submission `docker update --memory` against the container's cgroup, set/reset around each exec. Cgroup accounting reflects real physical usage, not virtual reservations. |
| `generic-pool` create/destroy | `create` popped from a pre-populated array instead of manufacturing a resource; `destroy` was wired to fire on normal release, which inverts the library's lifecycle; no health check | `create` spawns a fresh container; `destroy` kills and respawns one; `validate`/`testOnBorrow` health-checks before handing a container to a job |
| `lockDuration: 15000` hardcoded | Comment asserted "> max time limit," nothing enforced it | `assertProblemLimits()` rejects any problem whose time/memory limits violate the queue's invariants, checked at problem-save time |
| Dead/corrupted container silently recycled | No validation or eviction path existed | `validate()` health check + explicit infra-failure detection that routes to `pool.destroy()` instead of `pool.release()` |
| Java tokenizer | No handling for text blocks (`"""…"""`, Java 15+); no fallback for a non-`public` entry class | Text blocks blanked before string literals; entry-class detection falls back to scanning for `static void main` when no `public class` exists |
| Persistent-pool cleanup philosophy | "Remove the vector, don't clean it" was applied to `/dev/shm` but not to the container itself, which relied entirely on manual `pkill`+purge | Any run that hits a resource ceiling (TLE/MLE/signal-kill) forces a full destroy+respawn instead of trusting the cleanup script |
| `:latest` image tag | Non-reproducible judge environment | Pinned to a digest |
| Verdict/checker logic | Not specified anywhere in v2 | Minimal explicit contract added (§7) |
| Compile step | Implicitly bundled with run command under one `timeout`, so compile time could eat into or be bounded by the contestant's time limit | Separate `execFile` call, separate fixed global timeout, run before the per-problem-limited execution |
| No ingestion rate limit | Not addressed | Basic per-user in-flight guard added (§6) |

---

## 1. Worker Queue & Backpressure Valve

```js
const MAX_ALLOWED_TIME_LIMIT_SEC = 10;     // hard ceiling any problem may configure
const COMPILE_TIMEOUT_SEC = 10;            // fixed, not contestant-configurable
const LOCK_SAFETY_MARGIN_SEC = 5;

const LOCK_DURATION_MS =
  (MAX_ALLOWED_TIME_LIMIT_SEC + COMPILE_TIMEOUT_SEC + LOCK_SAFETY_MARGIN_SEC) * 1000;

new Worker('submissions', processJob, {
  connection: redis,
  concurrency: 4,             // matches pool size
  lockDuration: LOCK_DURATION_MS,
  stalledInterval: 5000,
});
```

**Enforced invariant, not just a comment:**
```js
function assertProblemLimits(problem) {
  if (problem.timeLimitSec > MAX_ALLOWED_TIME_LIMIT_SEC) {
    throw new ValidationError(`timeLimitSec exceeds queue ceiling of ${MAX_ALLOWED_TIME_LIMIT_SEC}s`);
  }
  if (problem.memoryLimitMB > POOL_DEFAULT_MEMORY_MB) {
    throw new ValidationError(`memoryLimitMB exceeds container ceiling of ${POOL_DEFAULT_MEMORY_MB}MB`);
  }
}
// Called at problem-save time in the admin/editor flow, AND defensively again at job-enqueue time.
```

**Verdicts vs. infra failures are different things — the queue should only ever see the latter.** A submission that times out or exceeds memory is a *successful* job whose *result* is `TLE`/`MLE` — it resolves normally. Only a genuine infrastructure fault (Docker daemon unreachable, container missing, pool exhausted) should throw and hit BullMQ's failed-job path. `attempts: 1` still stands: a job that fails for infra reasons should surface as `INFRA_ERROR` for operator attention, not silently retry into a second slot.

**Basic ingestion rate limit** (new — wasn't addressed at all before):
```js
async function tryReserveSlot(userId) {
  // NX + EX: only one in-flight submission per user; auto-expires if something wedges
  const ok = await redis.set(`inflight:${userId}`, '1', 'NX', 'EX', 30);
  return ok === 'OK';
}
// release with `redis.del(\`inflight:${userId}\`)` in the job's finally block
```

---

## 2. Sandboxed Execution Plane

```bash
docker run -d --init --user 1000:1000 \
  --memory=256m --memory-swap=256m --cpus="1.0" --pids-limit=64 \
  --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  --read-only \
  --tmpfs /dev/shm:rw,nosuid,nodev,noexec,size=1k,mode=1777 \
  --tmpfs /workspace:rw,size=64m,mode=1777,exec \
  codeforge/fat-judge@sha256:<pinned-digest> sleep infinity
```

Two changes from v2:
- **`--tmpfs /dev/shm:...size=1k`** replaces the invalid `--shm-size=0`. This overrides Docker's default 64m `/dev/shm` mount with one that's `noexec`, `nosuid`, `nodev`, and too small (1KB) for any meaningful cross-process shared payload — syntactically valid, functionally equivalent to disabled. Verify with `docker exec <c> df -h /dev/shm` — you should see a 1.0K mount, not 64.0M.
- **Digest pin** instead of `:latest`, so the judge environment can't silently drift mid-contest.

`--memory=256m` is now an **outer ceiling**, not the per-submission limit — the real per-submission cap is set dynamically (§3).

### Container pool — corrected lifecycle

```js
const { randomUUID } = require('crypto');
const { promisify } = require('util');
const execFileP = promisify(require('child_process').execFile);

const HARDENING_ARGS = [
  '--init', '--user', '1000:1000',
  '--memory=256m', '--memory-swap=256m', '--cpus=1.0', '--pids-limit=64',
  '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
  '--read-only',
  '--tmpfs', '/dev/shm:rw,nosuid,nodev,noexec,size=1k,mode=1777',
  '--tmpfs', '/workspace:rw,size=64m,mode=1777,exec',
];
const IMAGE = 'codeforge/fat-judge@sha256:<pinned-digest>';
const POOL_DEFAULT_MEMORY_MB = 256;

async function spawnContainer() {
  const name = `judge-worker-${randomUUID()}`;
  await execFileP('docker', ['run', '-d', '--name', name, ...HARDENING_ARGS, IMAGE, 'sleep', 'infinity']);
  return name;
}

async function killContainer(name) {
  await execFileP('docker', ['rm', '-f', name]).catch(() => {}); // best-effort; already-dead is fine
}

const pool = genericPool.createPool({
  create: spawnContainer,   // manufactures a NEW resource — this is what `create` means
  destroy: killContainer,   // permanently removes a resource; pool auto-refills toward min afterward
  validate: async (name) => {
    try {
      const { stdout } = await execFileP('docker', ['inspect', '-f', '{{.State.Running}}', name]);
      return stdout.trim() === 'true';
    } catch {
      return false; // container gone, daemon error, etc. — treat as unhealthy
    }
  },
}, {
  min: 4,
  max: 4,
  testOnBorrow: true,          // health-check before handing out
  acquireTimeoutMillis: 20000,
});

async function runInSandbox(job) {
  const container = await pool.acquire();
  let poisoned = false;
  try {
    return await runSubmission(container, job);   // §3 — never throws for TLE/MLE/RE, those are results
  } catch (err) {
    if (isInfraFailure(err)) poisoned = true;      // docker exec ENOENT, "no such container", daemon down, etc.
    throw err;
  } finally {
    if (poisoned || job.result?.hitResourceCeiling || job.submissionCountOnContainer(container) >= RECYCLE_AFTER_N) {
      await pool.destroy(container);   // kills + generic-pool refills to min via create()
    } else {
      await cleanupContainer(container);  // fast-path pkill + purge, §4
      await pool.release(container);
    }
  }
}
```

The important distinction from v2: **`isInfraFailure` only fires on things that mean the container itself is broken** — a wrong-answer or a legitimate timeout is not an infra failure and must not trigger a destroy/respawn cycle (that would waste pool capacity on every ordinary WA). Only genuine faults, or a run that hit a resource ceiling (see next point), force the heavier path.

This also closes the philosophical gap from v2: `/dev/shm` got "remove the vector" treatment but the container itself only got "clean it and hope." Now any run that hit a wall (TLE/MLE/killed-by-signal) forces a full destroy+respawn rather than trusting `pkill`+purge to have caught everything — and a periodic `RECYCLE_AFTER_N` (e.g. every 200 submissions) forces it regardless, as a hygiene backstop.

---

## 3. Per-Submission Limits — the JVM fix

`ulimit -v` bounds virtual address space. The JVM reserves virtual space for heap, metaspace, code cache, and per-thread stacks well beyond what it actually resides in physical memory — so a tight `ulimit -v` produces false `MLE` verdicts on *correct* Java solutions. That's a direct violation of the core axiom, and it was the JVM-specific irony of v2: the same section that hardened `-Xmx`/`-XX:MaxMetaspaceSize` also wrapped the process in a limit that misjudges it for unrelated reasons.

**Fix: use the container's actual cgroup instead of a process rlimit.** `docker update` is the Docker-supported way to change a running container's cgroup limits without a restart or hand-rolled `/sys/fs/cgroup` paths (which vary between the `cgroupfs` and `systemd` cgroup drivers — `docker update` abstracts that away):

```js
async function setMemoryCeiling(container, memoryLimitMB) {
  await execFileP('docker', [
    'update',
    `--memory=${memoryLimitMB}m`,
    `--memory-swap=${memoryLimitMB}m`,   // no swap headroom — keeps MLE/timing honest
    container,
  ]);
}

async function runSubmission(container, job) {
  const { problem, runCmd, compileCmd } = job.data;

  // 1. Compile — separate, fixed, global timeout. Never bounded by or eating into the
  //    contestant's per-problem time limit.
  await execFileP('docker', [
    'exec', '-u', '1000', '-e', 'HOME=/workspace', '-e', 'TMPDIR=/workspace',
    container, 'timeout', '-s', 'KILL', `${COMPILE_TIMEOUT_SEC}s`,
    'bash', '-c', compileCmd,
  ], { maxBuffer: 1024 * 1024 });

  // 2. Tighten the cgroup ceiling to this problem's declared limit. Runs right after cleanup
  //    from the previous submission, so current usage is near-zero — avoids the "can't lower
  //    below current usage" pitfall some cgroup/Docker versions have.
  await setMemoryCeiling(container, problem.memoryLimitMB);

  const start = Date.now();
  try {
    const result = await execFileP('docker', [
      'exec', '-u', '1000', '-e', 'HOME=/workspace', '-e', 'TMPDIR=/workspace',
      container, 'timeout', '-s', 'KILL', `${problem.timeLimitSec}s`,
      'bash', '-c', runCmd,
    ], { maxBuffer: 1024 * 1024 });
    return classifyResult(result, problem, Date.now() - start);
  } finally {
    await setMemoryCeiling(container, POOL_DEFAULT_MEMORY_MB); // always reset — never leave a tight
                                                                // ceiling on a pooled container
  }
}
```

**Why this actually fixes the JVM problem:** cgroup memory accounting reflects real resident + page-cache usage attributable to the process tree, not reserved virtual address space. `-Xmx96m` / `-XX:MaxMetaspaceSize=48m` now get compared against a number that means the same physical thing the JVM is actually consuming — no more phantom MLE on a correct solution. This mechanism is also uniform across every language, so `ulimit -v` is no longer needed anywhere in the pipeline.

**TLE vs. MLE disambiguation** — both `timeout -s KILL` and a cgroup OOM-kill deliver `SIGKILL` (exit 137), so exit code alone doesn't tell you which happened:

```js
function classifyResult({ code, signal }, problem, durationMs) {
  if (signal === 'SIGKILL' || code === 137) {
    const killedNearTimeLimit = durationMs >= problem.timeLimitSec * 1000 - 200;
    return killedNearTimeLimit ? 'TLE' : 'MLE'; // MVP heuristic — see note below
  }
  if (code !== 0) return 'RE';
  return 'AC_CANDIDATE'; // still subject to the checker, §7
}
```

The timing heuristic is good enough for an MVP but isn't exact. For a real contest, read the delta on the container's cgroup `memory.events` `oom_kill` counter across the run instead — it tells you definitively, regardless of timing, whether the kernel OOM-killed the process. The exact path depends on your cgroup driver (`docker info --format '{{.CgroupDriver}}'`); worth wiring up before you trust MLE verdicts at scale, but the heuristic above won't misclassify anything that isn't already borderline.

---

## 4. Execution Cleanup & De-contamination

```bash
pkill -9 -U 1000        # kill detached daemons — fast path, runs after every submission
# root-level workspace purge, exec -u 0
```

No `/dev/shm` step needed (disabled at the container level). This remains the **default** path for ordinary runs. It is explicitly **not** trusted after a run that hit a resource ceiling — those get a full `pool.destroy()` (kill + respawn) instead, per §2, on the theory that a run violent enough to need `SIGKILL` is also the run most likely to have left something the cleanup script doesn't know to look for.

---

## 5. Java-Specific Handling

**Tokenizer, extended for text blocks (Java 15+) and defensive char-literal handling** — order matters: text blocks must be blanked *before* the single-line string regex, or the triple-quote delimiters confuse it:

```js
function stripCommentsAndStrings(src) {
  return src
    .replace(/"""[\s\S]*?"""/g, '""')        // text blocks — must run first
    .replace(/"(\\.|[^"\\])*"/g, '""')        // ordinary string literals
    .replace(/'(\\.|[^'\\])*'/g, "''")       // char literals (defensive)
    .replace(/\/\/.*$/gm, '')                  // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '');         // block comments
}
```

**Entry-class extraction with a fallback for non-`public` classes** — `java`/`javac` both allow a file whose top-level class isn't `public`, as long as *something* in it has `static void main`:

```js
function extractEntryClass(cleanSrc) {
  const pub = cleanSrc.match(/public\s+(?:final\s+|abstract\s+)?class\s+(\w+)/);
  if (pub) return pub[1];

  // No public class — scan top-level classes for one containing a main method.
  for (const m of cleanSrc.matchAll(/\bclass\s+(\w+)[^{]*\{/g)) {
    const window = cleanSrc.slice(m.index, m.index + 2000);
    if (/static[^;{}]*main\s*\(/.test(window)) return m[1];
  }
  throw new JavaExtractionError('no class with a main method found');
}
```

This is regex-based, not a real parser — good enough for MVP judge submissions, but it's a heuristic, not a Java grammar. Worth a note in the codebase rather than pretending otherwise.

**JVM flags (unchanged from v2, still correct):**
```
-Xmx96m -XX:MaxMetaspaceSize=48m -XX:+UseSerialGC -XX:+UseContainerSupport
```

---

## 6. Ingestion, Race Protection & Delivery

```js
try {
  await db.submissions.insertOne({ _id: submissionId, status: 'QUEUED' });
} catch (err) {
  if (err.code !== 11000) throw err;   // only swallow the duplicate-key case
}
```

Plus the per-user in-flight guard from §1 at the API layer, before this insert ever runs. Everything else — `updateOne` upsert for the verdict, Redis Pub/Sub → SSE, `execFile` with argument arrays — unchanged from v2; it was already correct.

---

## 7. Verdict / Checker Contract (new — this was silently absent in v2)

```js
function defaultChecker(actual, expected) {
  const norm = s => s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}
```

`problem.checkerType`:
- `'exact'` (default) — line-trimmed, trailing-newline-insensitive byte compare, as above.
- `'float'` — token-wise compare with an absolute/relative epsilon; needed for any problem with floating-point output.
- `'special'` — an external checker binary, run in its own pool slot under the *same* time/memory discipline as the submission itself (it's still untrusted-ish code touching user output), fed `(input, submissionOutput, expectedOutput)` and returning AC/WA plus an optional message.

`float` and `special` are named contracts, not fully built out — but they're no longer an invisible gap.

---

## Verification checklist before your first real contest

None of this is "trust the doc" — run these once on your actual box:

- [ ] `docker info --format '{{.CgroupDriver}}'` — confirm cgroup v2 is in use; `docker update --memory` behavior and `memory.events` paths depend on it.
- [ ] `docker exec <container> df -h /dev/shm` — confirm it shows `1.0K`, not `64.0M`.
- [ ] Force-kill one pooled container manually (`docker rm -f <name>`) and confirm the pool spawns a fresh replacement within `acquireTimeoutMillis`.
- [ ] Submit a Java solution with a package-private (non-`public`) entry class, and one using a text block — confirm both extract correctly.
- [ ] Submit something that legitimately needs close to `problem.memoryLimitMB` in a JVM solution and confirm it no longer gets a false MLE.
- [ ] Confirm `assertProblemLimits` actually rejects a problem configured above `MAX_ALLOWED_TIME_LIMIT_SEC` or `POOL_DEFAULT_MEMORY_MB`.

---

## Explicitly deferred (named, not hidden)

- **Docker-socket trust boundary**: the worker process talks to the daemon, which is host-root-equivalent. `docker update`/`docker exec`/`docker rm` from the worker don't introduce new risk here — they exercise a privilege the worker already has via the socket. Out of scope to change for a single-laptop MVP; would matter with untrusted multi-tenant users.
- **Per-language memory tiers beyond a cgroup ceiling**: now more defensible than `ulimit -v` since accounting is exact, but adversarial memory-mapping/fork tricks at scale are still out of scope for friends running Python/C/C++/Java.
- **Ephemeral container-per-submission model** (what `isolate`-based judges like IOI's use): deferred in favor of a hardened, health-checked persistent pool. Named trade-off — lower latency per submission, at the cost of relying on cleanup+recycling discipline instead of "burn it down every time."

Three deliberate MVP-scope calls, all named — not gaps you're unaware of.

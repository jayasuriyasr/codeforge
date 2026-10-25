# CodeForge client — build status

Static PWA. Every submission is judged in the visitor's browser; there is no
backend server. Problems, optional accounts and saved submissions live in Supabase
(PostgreSQL with row-level security — `../supabase/schema.sql`). Hosted on Vercel
(see `DEPLOY.md`). Target
scale: a non-commercial college project, ≤ 10 000 users, $0 for years — feasible
because all compute is on the client and all toolchain bandwidth is on free CDNs.

## Language support

| language | mechanism | AC/WA | TLE | MLE | verified |
|---|---|---|---|---|---|
| **JavaScript** | Web Worker (native) | ✅ | ✅ wall-clock, `terminate()` | ⚠️ only an actual out-of-memory crash — a page can't measure a worker's JS heap (`performance.memory` doesn't exist in workers, even in Chrome); the Solve page says so | ✅ prod build, real browser |
| **Python 3** | Pyodide (CPython → WASM), jsDelivr | ✅ | ✅ wall-clock | ✅ **exact** — WASM heap delta vs post-warmup baseline | ✅ prod build, real browser |
| **C / C++** | emception compiles (Clang + lld → WASM); our own runner executes (`runners/wasm-exec.js`) | ✅ | ✅ wall-clock in a run worker; only that worker is killed | ✅ **exact** — final wasm heap size (it only grows) + refused growth past the cap | ✅ prod build, real browser: 10⁵-number inputs in ~100 ms |
| **Java** | CheerpJ 4.3 (JVM → WASM), Leaning Tech CDN; javac from `/tools.jar` on this site | ✅* | ✅* in-helper watchdog `Runtime.halt(124)` | ⚠️* `OutOfMemoryError` on stderr | ⚠️ run path ✅ in real Edge; **off until `tools.jar` is deployed** |

`*` Java status, verified in real Edge (headless, over the DevTools protocol):

- CheerpJ boots on this cross-origin-isolated site only because the runner marks
  CheerpJ's iframe `credentialless` (Chrome/Edge 110+). Without that the frame is
  blocked and Java hangs; Firefox/Safari get a clear "needs Chrome or Edge".
- The CFJudge helper loads the compiled class with its own class loader (the
  JVM's class path is fixed at boot, and `URLClassLoader` can't read CheerpJ's
  file system). A precompiled Two Sum solution runs and prints the right answer.
- **javac is the missing piece.** It lives in a Java 8 `tools.jar`, which CheerpJ
  reads through `/app/` = this site's root, so it must be deployed as
  `client/public/tools.jar`. Until then the Solve page shows Java as unavailable
  (no hang); once the file is there Java switches on by itself.

## Cross-origin isolation

The app is served with `COOP: same-origin` + `COEP: require-corp`
(`vercel.json` / `public/_headers`, re-applied by `public/sw.js`). emception
needs `SharedArrayBuffer`. Python and Monaco load fine — their CDN sends
`Cross-Origin-Resource-Policy: cross-origin`. CheerpJ's runtime iframe does not,
so it is embedded as a `credentialless` iframe (Chrome/Edge only).

## Known limitations (by design / by current tech)

1. ~~C/C++ stdin is one byte per syscall~~ — fixed: `wasm-exec.js` runs the linked
   binary with bulk stdin (emception's `wasi-run` is only a fallback now).
2. **C/C++ first use downloads ~30–50 MB** of LLVM/clang (Brotli-compressed) and
   takes 15–30 s to warm on a fast machine. One-time per browser, then
   IndexedDB + service-worker cached. Compile is memoised within a submission, so
   only case 1 pays the compile cost.
3. **JS memory isn't measured.** No browser exposes a worker's heap size, so a
   JavaScript program that merely exceeds the limit is not flagged; only a real
   out-of-memory crash is MLE. Python and C/C++ are exact.
4. **Java may block the main thread** while a submission runs (CheerpJ on the
   main thread). Acceptable for short practice runs; the watchdog covers infinite
   loops. Moving CheerpJ to a Web Worker is the follow-up if this bites.
5. **No contests.** The `server/` directory (v4 ephemeral-Docker judge, ICPC
   leaderboard) is kept for a future contest mode but is **not deployed** and not
   part of this build. Practice = 100 % client-side, every test case public.

## Layout

```
client/
  src/
    judge/
      index.js            dispatch + verdict pipeline (cpp/java runners are code-split)
      checker.js          output comparison (exact / float / token)
      loader.js           toolchain registry + prefetch
      runners/
        javascript.js     Blob Worker
        python.js         Pyodide Worker (real MLE, byte-interface stdin)
        cpp.js            emception 4.x — compile once, run each case
        wasm-exec.js      runs the compiled wasm: bulk stdin, real memory, clean TLE
        java.js           CheerpJ 4.3 + embedded CFJudge helper
    lib/profile.js        localStorage profile (guests)
    lib/problems.js       problems from Supabase (samples first, full tests on Judge)
    pages/                Catalog, Solve, Me
  content/problems/*.json  source problems  →  build  →  public/problems/*.json
  scripts/
    build-problems.mjs     validates + emits public/problems/
    gen-sample-problems.mjs the 6 seed problems
    java-helper/CFJudge.java source for the base64 blobs in runners/java.js
  public/
    sw.js                  two caches: APP (per-build) + TOOL (immutable CDN)
    _headers _redirects    Cloudflare Pages config
  src/_legacy/             the old server-coupled client — NOT built
```

## Next

- Run `VERIFY.md` §4 (Java) in real Chrome; fix or gate as needed.
- If C/C++ I/O speed matters for your problem set: run the linked `main.wasm` in
  a hand-written WASI worker (bulk `fd_read`) instead of emception's `wasi-run`.
- Consider trimming the C/C++ chunk (351 KB) — most of it is emception glue only
  a fraction of users hit.

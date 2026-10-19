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
| **JavaScript** | Web Worker (native) | ✅ | ✅ wall-clock, `terminate()` | ⚠️ best-effort (`performance.memory`, Chromium only) | ✅ prod build, real browser |
| **Python 3** | Pyodide (CPython → WASM), jsDelivr | ✅ | ✅ wall-clock | ✅ **exact** — WASM heap delta vs post-warmup baseline | ✅ prod build, real browser |
| **C / C++** | emception (Clang + lld → WASM), jsDelivr | ✅ | ✅ wall-clock, toolchain worker disposed | ⚠️ best-effort — `--max-memory` link cap + `bad_alloc`/OOM on stderr | ✅ prod build (compile+link+run+stdin+CE all confirmed) |
| **Java** | CheerpJ 4.3 (JVM → WASM), Leaning Tech CDN | ✅* | ✅* in-helper watchdog `Runtime.halt(124)` | ⚠️* `OutOfMemoryError` on stderr | ⛔ **not yet run in a real browser** — CheerpJ won't boot in the dev sandbox |

`*` Java runner is written to the pattern proven by Leaning Technologies'
own JavaFiddle (loader 4.3, `com.sun.tools.javac.Main.compile` with captured
diagnostics, stream redirection via an embedded `CFJudge` helper, `cjFileBlob`
read-back). It compiles cleanly and is code-split, but the end-to-end run has
**only** been exercised in a browser that can't finish booting a WASM JVM. Run
the **§4 checklist in `VERIFY.md`** in real Chrome before relying on Java.

## Cross-origin isolation

The app is served with `COOP: same-origin` + `COEP: require-corp`
(`public/_headers` + re-applied by `public/sw.js`). This is **required** for
C/C++ (emception needs `SharedArrayBuffer` to deliver stdin). It does not break
Python / Monaco / CheerpJ — every CDN we use sends
`Cross-Origin-Resource-Policy: cross-origin`. GitHub Pages can't set these
headers, so C/C++ is disabled there; the other four languages still work.

## Known limitations (by design / by current tech)

1. **C/C++ stdin is one byte per syscall** (emception's `wasi-run`). A problem
   with 10⁵+ input tokens can TLE in C/C++ *with a correct algorithm*. Keep
   C/C++-tagged problems' inputs modest. Every in-browser C/C++ toolchain has
   this today.
2. **C/C++ first use downloads ~30–50 MB** of LLVM/clang (Brotli-compressed) and
   takes 15–30 s to warm on a fast machine. One-time per browser, then
   IndexedDB + service-worker cached. Compile is memoised within a submission, so
   only case 1 pays the compile cost.
3. **JS MLE is best-effort.** `performance.memory` is Chromium-only; elsewhere an
   over-limit JS program surfaces as RE, not MLE. Python is the only exact one.
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
        java.js           CheerpJ 4.3 + embedded CFJudge helper
    lib/profile.js        localStorage profile (the only "account")
    lib/problems.js       fetches /problems/*.json
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

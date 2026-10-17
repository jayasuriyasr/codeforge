# Browser verification checklist

The client unit tests (`npm test`) cover the pure logic (checker, profile,
problem loader). The judging toolchains can only be verified in a real browser.
Run this list against a **production build** (`npm run build && npm run preview`,
then open `http://localhost:4173`) in **desktop Chrome or Edge** — that is the
only fully supported target.

> The sandboxed preview browser used during development can run JS, Python and
> C/C++ (slowly — no native Brotli), but **cannot run CheerpJ** (the JVM never
> finishes booting there). Java must be checked in real Chrome.

## 0. Isolation

- [ ] Console: `crossOriginIsolated` → `true`
- [ ] Console: `typeof SharedArrayBuffer` → `"function"`
- [ ] Application tab → Service Workers → `sw.js` is **activated**
- [ ] Reload offline (DevTools → Network → Offline) → the catalog and an
      already-opened problem still load

## 1. JavaScript  (STABLE — must pass)

Problem: **Two Sum**, language JavaScript.

- [ ] Correct solution → **AC**, all 6 cases green, per-case times shown
- [ ] `console.log('nope')` → **WA**, failing case reveals Input / Expected / Your output
- [ ] `while(true){}` → **TLE** at ~the time limit (tab does not hang)
- [ ] `const a=[];while(1)a.push(new Array(1e6))` → **MLE** or **RE** (best-effort on JS; Chromium reports MLE, other engines RE)

## 2. Python  (STABLE — must pass)

Problem: **Maximum Subarray**, language Python 3. First run downloads Pyodide (~12 MB).

- [ ] Kadane's algorithm → **AC**
- [ ] `print(0)` → **WA** with the failing case
- [ ] An O(n²) solution → **TLE** on the large case
- [ ] `x = [0] * 60_000_000` → **MLE** (this is the *exact* one — the reported MB should exceed the limit)
- [ ] A problem whose largest test case is a single ~50 KB line still finishes in < 1 s (stdin is not truncated — regression guard for the 8 KiB `setStdin` bug)

## 3. C and C++  (experimental — needs cross-origin isolation)

Problem: **Binary Search**. Switch language to **C11**. The badge should read
"first run downloads ~45 MB". First Judge: ~15–30 s on a fast machine while
clang/lld/libc stream in and compile; **subsequent Judges of the same code skip
straight to running each case** (compile is memoised).

- [ ] A correct C solution that **reads all of stdin once** (see the starter) → **AC**
- [ ] `int main(){ return x; }` → **CE**, panel shows the real clang diagnostic (no ANSI escapes)
- [ ] `#include <bits/stdc++.h>` in C++ compiles (the shim header is injected)
- [ ] `while(1){}` → **TLE**; the next Judge still works (the toolchain worker was disposed and re-booted)
- [ ] Switch to a non-isolated context (e.g. GitHub Pages) → the badge shows
      "not cross-origin isolated" and **Judge is disabled** for C/C++

**Known limit — large input:** emception delivers stdin one byte per syscall, so
a problem with 10⁵+ tokens of input can **TLE in C/C++ even with a correct
algorithm** (Binary Search's biggest case does). Keep C/C++-tagged problems'
inputs modest, or point students at Python/Java for I/O-heavy problems. This is a
limitation of every current in-browser C/C++ toolchain, not a bug in the app.

## 4. Java  (experimental — real Chrome only)

Problem: **Two Sum**. Switch to **Java**. First run downloads CheerpJ + `tools.jar`
(~20 MB) and boots the JVM — the first Judge can take 30–60 s.

- [ ] `public class Main` with a `Scanner` solution → **AC**
- [ ] A class with a syntax error → **CE**, panel shows the javac diagnostic
- [ ] `throw new RuntimeException("x")` in main → **RE** with the stack trace
- [ ] `int[] a = new int[Integer.MAX_VALUE];` → **MLE** (from `OutOfMemoryError` on stderr)
- [ ] `while(true){}` → **TLE** (the in-helper watchdog calls `Runtime.halt(124)`)
- [ ] The page stays responsive during a Java run *(if it does not — CheerpJ is
      blocking the main thread — that is the known risk; note it and consider the
      Web Worker mode as a follow-up)*

## 5. Profile / PWA

- [ ] Solve a problem → it shows ✓ on the catalog and the Profile count increments
- [ ] Reload → the solved set and the last-used language persist (localStorage)
- [ ] Profile page → Export downloads a JSON; Import restores it; Reset clears it
- [ ] Install the PWA (address-bar install icon) → it opens standalone

## If something fails

- **C/C++ "toolchain unavailable"** → `crossOriginIsolated` is `false`. The host
  is not sending COOP/COEP. See `DEPLOY.md`.
- **Java never returns** → CheerpJ could not boot. Check the console for
  `cjrtnc.leaningtech.com` request failures; confirm it is real Chrome/Edge.
- **Everything is slow the first time** → expected; the toolchains are caching.
  The second run of the same language is the real measure.

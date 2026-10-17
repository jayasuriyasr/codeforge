# Deploying CodeForge (static PWA)

The app in `client/` is a **fully static** single-page app. All judging runs in
the visitor's browser; there is no server, no database, no account system. Hosting
cost is $0 on any static host with a generous free tier.

## What gets deployed

`npm run build` (in `client/`) produces `client/dist/`:

| file | what |
|---|---|
| `index.html`, `assets/*` | the app shell (hashed, immutable) |
| `assets/cpp-*.js`, `assets/worker-entry-*.js` | the C/C++ toolchain glue — **code-split**, only fetched when someone picks C/C++ |
| `assets/java-*.js` | the Java (CheerpJ) loader + helper classes |
| `problems/index.json`, `problems/<slug>.json` | the problem set, generated from `content/problems/*.json` at build time |
| `sw.js` | service worker (stamped with a fresh `BUILD_ID` each build) |
| `manifest.webmanifest`, `_headers`, `_redirects` | PWA manifest + host config |

The heavy toolchains (Pyodide ~12 MB, Clang/LLVM ~45 MB, CheerpJ ~20 MB) are
**not** in `dist/` — they stream from jsDelivr / `cjrtnc.leaningtech.com` on first
use and are then held by the service worker + IndexedDB. That CDN bandwidth is
free and unmetered and never touches your hosting account.

## Vercel (one command)

Everything is pre-configured: `client/vercel.json` (build settings, COOP/COEP +
security headers, cache rules, SPA rewrite) and `client/package-lock.json`
(pins the exact tested dependency versions for Vercel's install).

From the repo root:

```bash
npm run deploy
```

The first run opens Vercel's login in your browser (OAuth device flow): approve
it once and the Vercel CLI remembers it. For CI or another machine, put a token
from <https://vercel.com/account/tokens> in `.env.deploy` (`VERCEL_TOKEN=`)
instead. That file is git-ignored and also holds `VERCEL_PROJECT_NAME` /
`VERCEL_SCOPE`.

The script (`scripts/deploy-vercel.mjs`) builds locally to fail fast, links
`client/` to the Vercel project on first run (creating it if needed; the link is
saved in `client/.vercel/`), then deploys to production and prints the URL.
`npm run deploy:preview` makes a preview deployment instead. The Vercel CLI runs
via `npx`, so nothing needs to be installed globally. To point at a different
account or project, delete `client/.vercel/` and run again.

**Git instead of CLI:** import the repo in the Vercel dashboard and set **Root
Directory** to `client`. `vercel.json` supplies everything else.

## Cloudflare Pages

Unlimited bandwidth on the free plan, and it honours the `_headers` file which we
need for cross-origin isolation (see below).

1. Push this repo to GitHub/GitLab.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → connect the repo.
3. Build settings:
   - **Framework preset:** none
   - **Build command:** `npm --prefix client ci && npm --prefix client run build`
   - **Build output directory:** `client/dist`
   - **Root directory:** `/` (repo root)
4. Environment variables: none required. Leave `VITE_BASE` unset (defaults to `/`).
5. Deploy. Every push to the production branch redeploys and the new `BUILD_ID`
   purges the previous app-shell cache automatically.

### Custom domain

Add it under the Pages project → **Custom domains**. `VITE_BASE` stays `/`.

## Other hosts

| host | works? | note |
|---|---|---|
| **Netlify** | yes | also reads `_headers` and `_redirects`. Same build settings. |
| **GitHub Pages** | partial | **no way to send `Cross-Origin-Embedder-Policy`**, so C/C++ won't work (its stdin needs `SharedArrayBuffer`). JS / Python / Java are fine. For a project site set `VITE_BASE=/<repo>/` before building. |
| **Vercel** | yes | ready to go — see [Vercel (one command)](#vercel-one-command). Headers live in `vercel.json`. |
| **any static host** | yes for JS/Python/Java | C/C++ needs the two COOP/COEP headers on the HTML response. |

## Cross-origin isolation (required for C/C++)

`public/_headers` sets:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

This unlocks `SharedArrayBuffer`, which the in-browser C/C++ toolchain
(`emception`) needs to pass stdin to a compiled program. It does **not** break
anything else: jsDelivr and `cjrtnc.leaningtech.com` send
`Cross-Origin-Resource-Policy: cross-origin` on every asset, so Pyodide, Monaco,
and the toolchains still load. The service worker (`public/sw.js`) also re-applies
these headers to same-origin responses, so isolation survives even from the
offline cache.

Verify after deploy: open the site, run `crossOriginIsolated` in the console — it
must be `true`.

## Updating problems

Edit / add JSON files under `client/content/problems/` (one file per problem,
filename = slug). `npm run build` validates them and regenerates
`client/public/problems/`. Redeploy. See `content/problems/` for the schema and
`scripts/build-problems.mjs` for the validation rules.

## Rollback

Cloudflare Pages keeps every deployment. Roll back from the dashboard →
**Deployments** → **⋯** → **Rollback**. No cache poisoning: each build's assets
are content-hashed and the service worker keys its shell cache on `BUILD_ID`.

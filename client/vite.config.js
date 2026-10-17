import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Regenerate the static problem JSON before dev/build.
function buildProblems() {
  return {
    name: 'build-problems',
    buildStart() {
      execFileSync(process.execPath, ['scripts/build-problems.mjs'], { stdio: 'inherit' });
    },
  };
}

// Stamp public/sw.js in the output with a unique build id so a redeploy
// invalidates the previous app cache.
function stampServiceWorker() {
  const id = Date.now().toString(36);
  return {
    name: 'stamp-sw',
    closeBundle() {
      const p = join('dist', 'sw.js');
      try {
        const src = readFileSync(p, 'utf8').replace(
          "self.__BUILD_ID__ || 'dev'",
          JSON.stringify(id),
        );
        writeFileSync(p, src);
      } catch { /* sw.js absent — fine */ }
    },
  };
}

export default defineConfig({
  // Set to '/<repo>/' for GitHub Pages project sites; '/' for Cloudflare Pages / a custom domain.
  base: process.env.VITE_BASE || '/',
  plugins: [buildProblems(), react(), stampServiceWorker()],
  build: {
    target: 'es2022',
    // The big test-case JSON lives in public/ and is copied verbatim.
    // Monaco is loaded from a CDN at runtime by @monaco-editor/react, so the
    // JS bundle stays small; default code-splitting is fine.
    chunkSizeWarningLimit: 1500,
  },
  // emception ships a `./subprocess_shim.py?raw` import and a
  // `new Worker(new URL('./worker-entry', import.meta.url))`. Both are handled
  // by Vite's own pipeline but NOT by the esbuild/rolldown dep pre-bundler,
  // which fails with "os error 123" on Windows. Excluding the packages makes
  // Vite serve/transform them as source instead of pre-bundling.
  optimizeDeps: {
    exclude: ['@gameguild/emception-browser', 'emception', '@gameguild/emception-xterm'],
  },
  worker: { format: 'es' },
  // Cross-origin isolation: unlocks SharedArrayBuffer, which emception needs to
  // feed stdin to a compiled C/C++ program (the byte callback can't cross the
  // worker boundary otherwise). jsDelivr assets send `Cross-Origin-Resource-
  // Policy: cross-origin`, so Pyodide / Monaco / toolchains still load under
  // COEP. Cloudflare Pages sets the same pair via public/_headers.
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The Supabase project URL and anon key are public by design — what a visitor
// may do is enforced by Row Level Security in the database. Accept the names
// the Vercel ↔ Supabase integration sets, plus VITE_* for a manual setup.
// Only these two values reach the browser bundle; never the service-role key.
function supabaseEnv(mode) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const pick = (...names) => names.map((n) => env[n]).find(Boolean) || '';
  return {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      pick('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      pick('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY',
        'VITE_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY')),
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

export default defineConfig(({ mode }) => ({
  // Set to '/<repo>/' for GitHub Pages project sites; '/' for Cloudflare Pages / a custom domain.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), stampServiceWorker()],
  define: supabaseEnv(mode),
  build: {
    target: 'es2022',
    // Problems and test cases live in Supabase, not in the bundle.
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
}));

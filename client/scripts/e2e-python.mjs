// client/scripts/e2e-python.mjs
// ── Run the Python-runner end-to-end checks in a headless browser ──────────
//
//   npm run dev                      (in another terminal; serves the runner)
//   node scripts/e2e-python.mjs      [--url http://localhost:5173] [--only TLE,MLE]
//
// Exits 1 if any check fails. The checks live in test/e2e/pythonRunner.scenarios.js.

import { openPage } from './lib/cdp.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const url = arg('--url', 'http://localhost:5173/');
const only = arg('--only', '');

const page = await openPage(url);
try {
  const ok = await page.evaluate('self.crossOriginIsolated');
  if (!ok) throw new Error(`${url} is not cross-origin isolated (COOP/COEP headers missing)`);
  const results = await page.evaluate(
    `import('/test/e2e/pythonRunner.scenarios.js').then((m) => m.runScenarios(${only ? JSON.stringify({ only: only.split(',') }) : '{}'}))`,
    15 * 60 * 1000,
  );
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.detail}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await page.close();
}

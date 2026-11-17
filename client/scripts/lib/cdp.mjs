// client/scripts/lib/cdp.mjs
// ── Minimal headless-browser driver (Chrome DevTools Protocol) ─────────────
// Starts Edge or Chrome headless with a throwaway profile, opens a page and
// evaluates code in it. No dependencies: Node's built-in fetch and WebSocket.
// Used by e2e-python.mjs and calibrate-python.mjs.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPage(url, { headless = true } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('No Edge/Chrome found — set BROWSER_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'cf-cdp-'));
  const args = [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', ...(headless ? ['--headless=new'] : []), 'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ }
  }
  if (!port) { proc.kill(); throw new Error('browser did not open a debugging port'); }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket failed')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

  /** Evaluate an expression (may return a promise); resolves with its JSON value. */
  async function evaluate(expression, timeoutMs = 600000) {
    const msg = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
    if (msg.result?.exceptionDetails) {
      const d = msg.result.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'evaluation failed');
    }
    if (msg.error) throw new Error(msg.error.message);
    return msg.result.result.value;
  }

  // wait for the real page (a new tab starts on about:blank, which is "complete" at once)
  const want = new URL(url).origin;
  let loaded = false;
  for (let i = 0; i < 300 && !loaded; i++) {
    try {
      const [origin, state] = await evaluate('[location.origin, document.readyState]', 5000);
      loaded = origin === want && state === 'complete';
    } catch { /* navigating */ }
    if (!loaded) await sleep(100);
  }
  if (!loaded) { await close(); throw new Error(`${url} did not load`); }

  async function close() {
    try { ws.close(); } catch { /* closed */ }
    proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked: leave it */ }
  }
  return { evaluate, close };
}

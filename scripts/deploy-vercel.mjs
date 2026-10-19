// scripts/deploy-vercel.mjs
// ── One-command deploy of the static client (client/) to Vercel ────────────
//
//   npm run deploy            → production
//   npm run deploy:preview    → preview URL, production untouched
//
// Sign-in, either:
//   • nothing to do — the first run opens Vercel's browser login (approve it
//     once; the Vercel CLI remembers it), or
//   • put a token in .env.deploy (VERCEL_TOKEN=...) — for CI / other machines.
//
// Vercel builds client/ itself (client/vercel.json: install, build, headers,
// SPA rewrite). We build locally first only to fail fast before uploading.
// First run links client/ to a Vercel project (creating it if needed); the
// link is saved in client/.vercel/ and reused afterwards.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'client');
const ENV_FILE = join(ROOT, '.env.deploy');
const VERCEL_CLI = 'vercel@63.1.2';
const PROD = !process.argv.includes('--preview');

const ENV_TEMPLATE = `# ── Vercel deploy settings (git-ignored — never commit this file) ──
#
# Run:  npm run deploy
#
# Sign-in: leave VERCEL_TOKEN empty and the first deploy opens Vercel's login
# in your browser (approve it once). Or, for CI / another machine, create a
# token at https://vercel.com/account/tokens and paste it after the = sign
# (no quotes, no spaces).
VERCEL_TOKEN=

# Project name on Vercel. The site goes to https://<name>.vercel.app
# (Vercel adds a suffix if that name is taken). Lowercase letters, digits, - _ .
VERCEL_PROJECT_NAME=codeforge-arena

# Leave empty to deploy to your personal account. Set it to a team's slug to
# deploy under that Vercel team instead.
VERCEL_SCOPE=
`;

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1'), red = c('31'), green = c('32'), cyan = c('36');

function fail(msg) {
  console.error(`\n${red('✖')} ${msg}\n`);
  process.exit(1);
}

function step(msg) {
  console.log(`\n${cyan('▸')} ${bold(msg)}`);
}

function readEnvFile() {
  if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, ENV_TEMPLATE);
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

// Every argument is validated to a safe token below, so joining them into one
// shell command is safe — and the shell is what lets `npx`/`npm` resolve to
// their .cmd shims on Windows.
function run(cmd, args, { cwd, env, capture = false } = {}) {
  const r = spawnSync([cmd, ...args].join(' '), {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'],
    encoding: 'utf8',
  });
  if (r.error) fail(`Could not run ${cmd}: ${r.error.message}`);
  return { ok: r.status === 0, stdout: (r.stdout || '').trim() };
}

// `vercel whoami` prints the username; tolerate a JSON shape too.
function username(stdout) {
  try {
    const j = JSON.parse(stdout);
    return j.username || j.name || j.user?.username || stdout;
  } catch {
    return stdout.split(/\r?\n/).pop();
  }
}

// ── settings ────────────────────────────────────────────────────────────────
const file = readEnvFile();
const token = (process.env.VERCEL_TOKEN || file.VERCEL_TOKEN || '').trim();
const project = (file.VERCEL_PROJECT_NAME || 'codeforge-arena').trim();
const scope = (file.VERCEL_SCOPE || '').trim();

if (/\s/.test(token)) fail('VERCEL_TOKEN contains spaces — paste just the token itself.');
if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(project) || project.includes('---')) {
  fail(`VERCEL_PROJECT_NAME "${project}" is invalid — use lowercase letters, digits, "-", "_" or "." (max 100).`);
}
if (scope && !/^[A-Za-z0-9_-]+$/.test(scope)) fail(`VERCEL_SCOPE "${scope}" is invalid — use the team slug from its Vercel URL.`);

// A token travels as an env var, never on the command line (process lists, logs).
// Without one, the Vercel CLI uses its own saved browser login. The CLI version
// is pinned, so skip its "upgrade now? (Y/n)" prompt, which would stall the run.
const vercelEnv = { NO_UPDATE_NOTIFIER: '1', ...(token ? { VERCEL_TOKEN: token } : {}) };
const scopeArgs = scope ? ['--scope', scope] : [];
const vercel = (args, opts = {}) =>
  run('npx', ['--yes', VERCEL_CLI, ...args, ...scopeArgs], { cwd: CLIENT, env: vercelEnv, ...opts });
const whoami = () => vercel(['whoami', '--non-interactive'], { capture: true });

// ── 1. local build (fail fast) ──────────────────────────────────────────────
step('Building locally to catch errors before uploading');
if (!run('npm', ['run', 'build'], { cwd: ROOT }).ok) fail('Local build failed — fix the errors above, then deploy again.');

// ── 2. sign in ──────────────────────────────────────────────────────────────
step('Checking Vercel sign-in');
let who = whoami();
if (!who.ok || !who.stdout) {
  if (token) fail('Vercel rejected the token in .env.deploy. Make a new one at https://vercel.com/account/tokens, or clear it to use the browser login.');
  console.log('  Not signed in yet — starting the Vercel login.');
  console.log(`  ${bold('Approve the request in your browser')} (check the code matches), then this continues.\n`);
  if (!vercel(['login']).ok) fail('Vercel login did not finish. Run npm run deploy again to retry.');
  who = whoami();
  if (!who.ok || !who.stdout) fail('Still not signed in to Vercel. Run npm run deploy again to retry.');
}
console.log(`  Signed in as ${bold(username(who.stdout))}`);

// ── 3. link client/ to the Vercel project (first run only) ──────────────────
if (!existsSync(join(CLIENT, '.vercel', 'project.json'))) {
  step(`Linking client/ to Vercel project "${project}"`);
  if (!vercel(['link', '--yes', '--project', project]).ok) {
    console.log(`  Could not link — creating project "${project}" first…`);
    if (!vercel(['project', 'add', project]).ok) {
      fail('Could not create the Vercel project. Check your Vercel account access (and VERCEL_SCOPE, if set).');
    }
    if (!vercel(['link', '--yes', '--project', project]).ok) fail('Could not link client/ to the Vercel project.');
  }
}

// ── 4. deploy ───────────────────────────────────────────────────────────────
step(PROD ? 'Deploying to production (Vercel builds it remotely)' : 'Deploying a preview (Vercel builds it remotely)');
const deploy = vercel(['deploy', '--yes', ...(PROD ? ['--prod'] : [])], { capture: true });
if (!deploy.ok) {
  fail(
    'Deploy failed — see the Vercel output above.\n' +
    '  • signed in to the wrong account / project → delete the client/.vercel folder and run again',
  );
}

// stdout is the deployment URL — or, when the CLI runs non-interactively, JSON
// that contains it. Take the last vercel.app URL either way.
const url = deploy.stdout.match(/https:\/\/[^\s"']+\.vercel\.app/g)?.pop() || deploy.stdout.trim();
console.log(`\n${green('✔')} ${bold(PROD ? 'Deployed to production' : 'Preview deployed')}: ${url}`);
if (PROD) console.log(`  Your permanent site address is the "Aliased" / production URL printed above.`);
console.log(`  Check: open the site, run  crossOriginIsolated  in the browser console → must be true.\n`);

// scripts/db-setup.mjs
// ── Set up the Supabase database ───────────────────────────────────────────
//
//   npm run db:setup                      apply supabase/schema.sql + load the
//                                         built-in problems (content/problems)
//   npm run db:setup -- --make-admin you@example.com
//                                         give an existing account the admin role
//   npm run db:setup -- --status          counts of problems / users / submissions
//
// Reads the connection string that `vercel env pull` writes to
// client/.env.local (POSTGRES_URL_NON_POOLING, else POSTGRES_URL). Nothing is
// printed from it.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, 'client', '.env.local');
const SCHEMA = join(ROOT, 'supabase', 'schema.sql');
const PROBLEMS = join(ROOT, 'client', 'content', 'problems');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

export function readEnv(file = ENV_FILE) {
  if (!existsSync(file)) {
    fail('client/.env.local not found. Run `npx vercel env pull` inside client/ first.');
  }
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

export async function connect() {
  const env = readEnv();
  const raw = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.DATABASE_URL;
  if (!raw) fail('No POSTGRES_URL in client/.env.local — is the Supabase integration connected?');
  // Supabase requires TLS; its certificate chain isn't in Node's default store.
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('supa');
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function applySchema(db) {
  await db.query(readFileSync(SCHEMA, 'utf8'));
  console.log('✔ schema applied (tables, security rules, functions)');
}

async function seedProblems(db) {
  const files = readdirSync(PROBLEMS).filter((f) => f.endsWith('.json'));
  let added = 0;
  await db.query('begin');
  try {
    for (const file of files) {
      const p = JSON.parse(readFileSync(join(PROBLEMS, file), 'utf8'));
      const { rows } = await db.query(
        `insert into public.problems
           (slug, title, difficulty, tags, statement, time_limit_sec, memory_limit_mb, checker_type, published, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, true, null)
         on conflict (slug) do nothing
         returning id`,
        [p.slug, p.title, p.difficulty, p.tags || [], p.statement, p.timeLimitSec, p.memoryLimitMB, p.checkerType || 'exact'],
      );
      if (!rows.length) continue; // already loaded
      const id = rows[0].id;
      for (const [i, c] of p.testCases.entries()) {
        await db.query(
          'insert into public.test_cases (problem_id, position, input, expected_output, is_sample) values ($1, $2, $3, $4, $5)',
          [id, i, c.input, c.expectedOutput, !!c.sample],
        );
      }
      added++;
    }
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
  console.log(`✔ built-in problems: ${added} added, ${files.length - added} already present`);
}

async function makeAdmin(db, email) {
  const { rowCount } = await db.query(
    `update public.profiles set role = 'admin'
     where id = (select id from auth.users where lower(email) = lower($1))`,
    [email],
  );
  if (!rowCount) fail(`No account with email ${email}. Sign up on the site first, then run this again.`);
  console.log(`✔ ${email} is now an admin`);
}

async function status(db) {
  const { rows: [s] } = await db.query(`select
    (select count(*) from public.problems)                       as problems,
    (select count(*) from public.problems where published)       as published,
    (select count(*) from public.profiles)                       as users,
    (select count(*) from public.profiles where role = 'admin')  as admins,
    (select count(*) from public.submissions)                    as submissions`);
  console.table(s);
}

async function main() {
  const args = process.argv.slice(2);
  const db = await connect();
  try {
    if (args[0] === '--make-admin') {
      if (!args[1]) fail('Usage: npm run db:setup -- --make-admin you@example.com');
      await makeAdmin(db, args[1]);
    } else if (args[0] === '--status') {
      await status(db);
    } else {
      await applySchema(db);
      await seedProblems(db);
      await status(db);
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => fail(e.message));
}

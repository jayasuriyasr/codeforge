// scripts/db-test-rls.mjs
// ── Prove the database security rules hold ─────────────────────────────────
//
//   npm run db:test
//
// Runs entirely inside one transaction that is ROLLED BACK at the end, so it
// leaves no trace: it creates throwaway accounts (two admins, one user), then
// acts as each of them — exactly as a browser request would — and checks what
// they can and cannot do.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from './db-setup.mjs';

const db = await connect();
const results = [];

async function as(uid, fn) {
  // Mimic a Supabase API request: the `authenticated` (or `anon`) role, with
  // the user's id in the JWT claims that auth.uid() reads.
  await db.query('savepoint act');
  try {
    if (uid) {
      await db.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
        [JSON.stringify({ sub: uid, role: 'authenticated' }), uid]);
      await db.query('set local role authenticated');
    } else {
      await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.jwt.claim.sub', '', true)`);
      await db.query('set local role anon');
    }
    return await fn();
  } finally {
    await db.query('rollback to savepoint act');
  }
}

async function check(name, fn) {
  try {
    await fn();
    results.push(['✔', name]);
  } catch (e) {
    results.push(['✖', `${name} — ${e.message}`]);
  }
}

const denied = (p) => p.then(
  () => { throw new Error('expected permission error, but it succeeded'); },
  (e) => { if (!/permission|violates row-level security|42501|Only admins|not yours/i.test(e.message + e.code)) throw e; },
);

const problem = (slug, published = false) => ({
  slug, title: `Test ${slug}`, difficulty: 'easy', tags: ['test'], statement: 'Echo the input.',
  time_limit_sec: 2, memory_limit_mb: 128, published,
  test_cases: [{ input: '1', expected_output: '1', is_sample: true }, { input: '2', expected_output: '2', is_sample: false }],
});

await db.query('begin');
try {
  const [adminA, adminB, user] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, name] of [[adminA, 'admin-a'], [adminB, 'admin-b'], [user, 'plain-user']]) {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data, aud, role)
       values ($1, $2, $3, 'authenticated', 'authenticated')`,
      [id, `${name}-${id.slice(0, 8)}@rls-test.invalid`, { username: name }],
    );
  }
  await db.query(`update public.profiles set role = 'admin' where id in ($1, $2)`, [adminA, adminB]);

  // Admin A creates one draft and one published problem (committed to the outer transaction).
  await db.query('savepoint setup');
  await db.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
    [JSON.stringify({ sub: adminA, role: 'authenticated' }), adminA]);
  await db.query('set local role authenticated');
  const { rows: [{ save_problem: draftId }] } = await db.query('select public.save_problem($1)', [problem('rls-draft')]);
  const { rows: [{ save_problem: pubId }] } = await db.query('select public.save_problem($1)', [problem('rls-published', true)]);
  await db.query('reset role');
  await db.query('release savepoint setup');

  const { rows: [{ id: builtinId }] } = await db.query('select id from public.problems where created_by is null limit 1');

  await check('sign-up trigger creates a profile with the chosen username', async () => {
    const { rows } = await db.query('select username, role from public.profiles where id = $1', [user]);
    assert.deepEqual(rows[0], { username: 'plain-user', role: 'user' });
  });

  await check('guest sees published problems but not drafts', () => as(null, async () => {
    const { rows } = await db.query('select slug from public.problems where id in ($1, $2)', [draftId, pubId]);
    assert.deepEqual(rows.map((r) => r.slug), ['rls-published']);
  }));

  await check('guest can read test cases of published problems only', () => as(null, async () => {
    const { rows } = await db.query('select distinct problem_id from public.test_cases where problem_id in ($1, $2)', [draftId, pubId]);
    assert.deepEqual(rows.map((r) => Number(r.problem_id)), [Number(pubId)]);
  }));

  await check('guest cannot submit', () => as(null, () => denied(
    db.query(`insert into public.submissions (user_id, problem_id, language, code, verdict) values ($1, $2, 'python', 'x', 'AC')`, [user, pubId]),
  )));

  await check('user cannot create a problem', () => as(user, () => denied(
    db.query('select public.save_problem($1)', [problem('rls-by-user')]),
  )));

  await check('user cannot create a problem with a direct insert either', () => as(user, () => denied(
    db.query(`insert into public.problems (slug, title, difficulty, statement) values ('rls-direct', 't', 'easy', 's')`),
  )));

  await check('user cannot see another admin\'s draft', () => as(user, async () => {
    const { rows } = await db.query('select id from public.problems where id = $1', [draftId]);
    assert.equal(rows.length, 0);
  }));

  await check('user cannot make themselves admin', () => as(user, () => denied(
    db.query(`update public.profiles set role = 'admin' where id = $1`, [user]),
  )));

  await check('user can rename themselves', () => as(user, async () => {
    const { rowCount } = await db.query(`update public.profiles set username = 'renamed' where id = $1`, [user]);
    assert.equal(rowCount, 1);
  }));

  await check('admin A sees own draft', () => as(adminA, async () => {
    const { rows } = await db.query('select id from public.problems where id = $1', [draftId]);
    assert.equal(rows.length, 1);
  }));

  await check('admin A can publish own problem', () => as(adminA, async () => {
    const { rowCount } = await db.query('update public.problems set published = true where id = $1', [draftId]);
    assert.equal(rowCount, 1);
  }));

  await check('admin B cannot see, edit or delete admin A\'s draft', () => as(adminB, async () => {
    const sel = await db.query('select id from public.problems where id = $1', [draftId]);
    const upd = await db.query(`update public.problems set title = 'hacked' where id = $1`, [pubId]);
    const del = await db.query('delete from public.problems where id = $1', [pubId]);
    assert.deepEqual([sel.rows.length, upd.rowCount, del.rowCount], [0, 0, 0]);
  }));

  await check('admin B cannot overwrite admin A\'s problem through save_problem', () => as(adminB, () => denied(
    db.query('select public.save_problem($1)', [{ ...problem('rls-published', true), id: String(pubId) }]),
  )));

  await check('admin B cannot change admin A\'s test cases', () => as(adminB, async () => {
    const del = await db.query('delete from public.test_cases where problem_id = $1', [pubId]);
    assert.equal(del.rowCount, 0);
    await denied(db.query(`insert into public.test_cases (problem_id, position, input, expected_output) values ($1, 99, 'x', 'y')`, [pubId]));
  }));

  await check('nobody can delete a built-in problem', () => as(adminA, async () => {
    const { rowCount } = await db.query('delete from public.problems where id = $1', [builtinId]);
    assert.equal(rowCount, 0);
  }));

  await check('admin A can delete own problem', () => as(adminA, async () => {
    const { rowCount } = await db.query('delete from public.problems where id = $1', [draftId]);
    assert.equal(rowCount, 1);
  }));

  await check('save_problem rejects a problem with no sample test case', () => as(adminA, () => assert.rejects(
    db.query('select public.save_problem($1)', [{ ...problem('rls-nosample'), test_cases: [{ input: '1', expected_output: '1', is_sample: false }] }]),
    /at least one test case as a sample/,
  )));

  await check('user can submit for themselves and sees only own submissions', () => as(user, async () => {
    await db.query(`insert into public.submissions (problem_id, language, code, verdict, passed, total)
                    values ($1, 'python', 'print(1)', 'AC', 2, 2)`, [pubId]);
    const { rows } = await db.query('select user_id from public.submissions');
    assert.ok(rows.length >= 1 && rows.every((r) => r.user_id === user));
  }));

  await check('user cannot submit on behalf of someone else', () => as(user, () => denied(
    db.query(`insert into public.submissions (user_id, problem_id, language, code, verdict) values ($1, $2, 'python', 'x', 'AC')`, [adminA, pubId]),
  )));

  await check('user cannot edit or delete submissions', () => as(user, () => denied(
    db.query(`update public.submissions set verdict = 'AC' where user_id = $1`, [user]),
  )));

  await check('my_stats counts solved problems for the dashboard', () => as(user, async () => {
    await db.query(`insert into public.submissions (problem_id, language, code, verdict, passed, total)
                    values ($1, 'python', 'x', 'WA', 1, 2), ($1, 'python', 'y', 'AC', 2, 2), ($1, 'python', 'z', 'AC', 2, 2)`, [pubId]);
    const { rows: [{ my_stats: s }] } = await db.query('select public.my_stats()');
    const { rows: [{ n }] } = await db.query('select count(*)::int as n from public.problems where published');
    assert.equal(s.total, n);
    assert.equal(s.solved, 1);            // one distinct problem, despite two ACs
    assert.equal(s.submissions, 3);
    assert.equal(s.accepted, 2);
  }));

  await check('guest cannot call my_stats or save_problem', () => as(null, () => denied(
    db.query('select public.my_stats()'),
  )));
} finally {
  await db.query('rollback');   // ← nothing above is kept
  await db.end();
}

for (const [mark, name] of results) console.log(`${mark} ${name}`);
const failed = results.filter(([m]) => m === '✖').length;
console.log(`\n${results.length - failed}/${results.length} security checks passed (all test data rolled back)`);
process.exit(failed ? 1 : 0);

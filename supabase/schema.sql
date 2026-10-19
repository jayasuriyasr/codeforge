-- supabase/schema.sql
-- ── CodeForge database ─────────────────────────────────────────────────────
--
-- There is no backend: the browser talks to Supabase directly with the public
-- anon key, so every access rule lives here as Row Level Security (RLS).
--
--   profiles     one row per account (username, role = user | admin)
--   problems     statement + limits; admins create/edit/delete only their own
--   test_cases   per-problem input / expected output; readable with the problem
--   submissions  every judged submission; users see only their own
--
-- Apply with `npm run db:setup` (or paste into the Supabase SQL editor).
-- Safe to re-run.

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null check (char_length(username) between 2 and 32),
  role       text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Every new auth user gets a profile; the username comes from the sign-up form.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))), 32);
begin
  if char_length(name) < 2 then name := 'user-' || left(new.id::text, 6); end if;
  insert into public.profiles (id, username) values (new.id, name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ── problems ────────────────────────────────────────────────────────────────
create table if not exists public.problems (
  id              bigint generated always as identity primary key,
  slug            text not null unique
                    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title           text not null check (char_length(title) between 1 and 120),
  difficulty      text not null check (difficulty in ('easy', 'medium', 'hard')),
  tags            text[] not null default '{}',
  statement       text not null check (char_length(statement) between 1 and 20000),
  time_limit_sec  numeric(3, 1) not null default 2 check (time_limit_sec between 0.5 and 10),
  memory_limit_mb int not null default 128 check (memory_limit_mb between 16 and 512),
  checker_type    text not null default 'exact' check (checker_type in ('exact', 'float')),
  published       boolean not null default false,
  -- null = built-in problem (seeded); nobody can edit or delete those.
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists problems_created_by on public.problems (created_by);

-- ── test_cases ──────────────────────────────────────────────────────────────
create table if not exists public.test_cases (
  id              bigint generated always as identity primary key,
  problem_id      bigint not null references public.problems (id) on delete cascade,
  position        int not null check (position >= 0),
  input           text not null check (char_length(input) <= 1000000),
  expected_output text not null check (char_length(expected_output) <= 1000000),
  is_sample       boolean not null default false,
  unique (problem_id, position)
);

-- ── submissions ─────────────────────────────────────────────────────────────
create table if not exists public.submissions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  problem_id bigint not null references public.problems (id) on delete cascade,
  language   text not null check (language in ('javascript', 'python', 'c', 'cpp', 'java')),
  code       text not null check (char_length(code) <= 65536),
  verdict    text not null check (verdict in ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE')),
  passed     int not null default 0 check (passed >= 0),
  total      int not null default 0 check (total >= 0),
  runtime_ms int check (runtime_ms >= 0),
  memory_mb  numeric(8, 1) check (memory_mb >= 0),
  created_at timestamptz not null default now(),
  check (passed <= total)
);
create index if not exists submissions_user_created on public.submissions (user_id, created_at desc);
create index if not exists submissions_problem on public.submissions (problem_id);

-- ── privileges: start from nothing, grant only what the app uses ────────────
revoke all on public.profiles, public.problems, public.test_cases, public.submissions from anon, authenticated;
grant select on public.problems, public.test_cases to anon, authenticated;
grant insert, update, delete on public.problems, public.test_cases to authenticated;
grant select, insert on public.submissions to authenticated;
grant select on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;   -- never `role`

-- ── row level security ──────────────────────────────────────────────────────
alter table public.profiles    enable row level security;
alter table public.problems    enable row level security;
alter table public.test_cases  enable row level security;
alter table public.submissions enable row level security;

drop policy if exists "signed-in users read profiles" on public.profiles;
create policy "signed-in users read profiles" on public.profiles
  for select to authenticated using (true);

drop policy if exists "users rename themselves" on public.profiles;
create policy "users rename themselves" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Everyone (guests too) sees published problems; an admin also sees own drafts.
drop policy if exists "read published or own problems" on public.problems;
create policy "read published or own problems" on public.problems
  for select using (published or created_by = (select auth.uid()));

drop policy if exists "admins create problems" on public.problems;
create policy "admins create problems" on public.problems
  for insert to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

drop policy if exists "admins edit own problems" on public.problems;
create policy "admins edit own problems" on public.problems
  for update to authenticated
  using ((select public.is_admin()) and created_by = (select auth.uid()))
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

drop policy if exists "admins delete own problems" on public.problems;
create policy "admins delete own problems" on public.problems
  for delete to authenticated
  using ((select public.is_admin()) and created_by = (select auth.uid()));

drop policy if exists "read test cases of visible problems" on public.test_cases;
create policy "read test cases of visible problems" on public.test_cases
  for select using (exists (
    select 1 from public.problems p
    where p.id = problem_id and (p.published or p.created_by = (select auth.uid()))
  ));

drop policy if exists "admins manage test cases of own problems" on public.test_cases;
create policy "admins manage test cases of own problems" on public.test_cases
  for all to authenticated
  using ((select public.is_admin()) and exists (
    select 1 from public.problems p where p.id = problem_id and p.created_by = (select auth.uid())
  ))
  with check ((select public.is_admin()) and exists (
    select 1 from public.problems p where p.id = problem_id and p.created_by = (select auth.uid())
  ));

drop policy if exists "users read own submissions" on public.submissions;
create policy "users read own submissions" on public.submissions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "users add own submissions" on public.submissions;
create policy "users add own submissions" on public.submissions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.problems p
    where p.id = problem_id and (p.published or p.created_by = (select auth.uid()))
  ));

-- ── save_problem: create or update a problem + replace its test cases ───────
-- One call = one transaction, so a problem never ends up half-saved. Runs as
-- the caller (security invoker): the RLS policies above still apply.
create or replace function public.save_problem(p jsonb)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  pid   bigint := nullif(p ->> 'id', '')::bigint;
  cases jsonb  := coalesce(p -> 'test_cases', '[]'::jsonb);
  tc    jsonb;
  pos   int    := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can create problems.' using errcode = '42501';
  end if;
  if jsonb_array_length(cases) = 0 then
    raise exception 'Add at least one test case.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(cases) c where (c ->> 'is_sample')::boolean) then
    raise exception 'Mark at least one test case as a sample.' using errcode = '22023';
  end if;

  if pid is null then
    insert into public.problems (slug, title, difficulty, tags, statement,
                                 time_limit_sec, memory_limit_mb, checker_type, published)
    values (p ->> 'slug', p ->> 'title', p ->> 'difficulty',
            coalesce(array(select jsonb_array_elements_text(p -> 'tags')), '{}'),
            p ->> 'statement', (p ->> 'time_limit_sec')::numeric, (p ->> 'memory_limit_mb')::int,
            coalesce(p ->> 'checker_type', 'exact'), coalesce((p ->> 'published')::boolean, false))
    returning id into pid;
  else
    update public.problems set
      slug = p ->> 'slug', title = p ->> 'title', difficulty = p ->> 'difficulty',
      tags = coalesce(array(select jsonb_array_elements_text(p -> 'tags')), '{}'),
      statement = p ->> 'statement',
      time_limit_sec = (p ->> 'time_limit_sec')::numeric,
      memory_limit_mb = (p ->> 'memory_limit_mb')::int,
      checker_type = coalesce(p ->> 'checker_type', 'exact'),
      published = coalesce((p ->> 'published')::boolean, published),
      updated_at = now()
    where id = pid;
    if not found then
      raise exception 'Problem not found, or it is not yours.' using errcode = '42501';
    end if;
    delete from public.test_cases where problem_id = pid;
  end if;

  for tc in select * from jsonb_array_elements(cases) loop
    insert into public.test_cases (problem_id, position, input, expected_output, is_sample)
    values (pid, pos, coalesce(tc ->> 'input', ''), coalesce(tc ->> 'expected_output', ''),
            coalesce((tc ->> 'is_sample')::boolean, false));
    pos := pos + 1;
  end loop;
  return pid;
end $$;

-- ── my_stats: everything the profile dashboard needs, in one call ───────────
create or replace function public.my_stats()
returns json language sql stable security invoker set search_path = '' as $$
  with pub as (
    select id, difficulty from public.problems where published
  ), solved as (
    select distinct s.problem_id from public.submissions s
    join pub on pub.id = s.problem_id
    where s.user_id = auth.uid() and s.verdict = 'AC'
  ), mine as (
    select verdict from public.submissions where user_id = auth.uid()
  )
  select json_build_object(
    'total',       (select count(*) from pub),
    'solved',      (select count(*) from solved),
    'submissions', (select count(*) from mine),
    'accepted',    (select count(*) from mine where verdict = 'AC'),
    'by_difficulty', (
      select coalesce(json_agg(d order by array_position(array['easy','medium','hard'], d.difficulty)), '[]')
      from (
        select pub.difficulty, count(*) as total, count(solved.problem_id) as solved
        from pub left join solved on solved.problem_id = pub.id
        group by pub.difficulty
      ) d
    )
  );
$$;

revoke all on function public.save_problem(jsonb), public.my_stats() from public, anon;
grant execute on function public.save_problem(jsonb), public.my_stats() to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

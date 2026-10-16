-- Study Ladder database. Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Every table has row-level security, so the public (anon) key only ever reaches
-- what the signed-in student is allowed to see.

-- ---------- Private workspace: one row per saved item (course, material, lesson, answer) ----------
create table if not exists public.docs (
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  col        text not null check (col in ('courses', 'sources', 'lessons', 'attempts')),
  id         text not null check (length(id) between 1 and 200),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, col, id)
);
create index if not exists docs_owner_col on public.docs (owner, col);
alter table public.docs enable row level security;
drop policy if exists "docs: owner only" on public.docs;
create policy "docs: owner only" on public.docs
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- ---------- Admins (you). Add yourself after your first sign-in, see README. ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security; -- no policies: only the service role can change it

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- Community: courses students chose to share (path + exam format only) ----------
create table if not exists public.community (
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id   text not null,
  author_name text not null default 'A student' check (length(author_name) <= 80),
  data        jsonb not null,
  shared_at   timestamptz not null default now(),
  primary key (owner, course_id)
);
alter table public.community enable row level security;
drop policy if exists "community: signed-in read" on public.community;
drop policy if exists "community: share own" on public.community;
drop policy if exists "community: update own" on public.community;
drop policy if exists "community: remove own or admin" on public.community;
create policy "community: signed-in read" on public.community for select to authenticated using (true);
create policy "community: share own" on public.community for insert to authenticated with check (owner = auth.uid());
create policy "community: update own" on public.community for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "community: remove own or admin" on public.community for delete to authenticated using (owner = auth.uid() or public.is_admin());

-- ---------- Reports on community courses ----------
create table if not exists public.reports (
  id           bigint generated always as identity primary key,
  course_owner uuid not null,
  course_id    text not null,
  reporter     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason       text not null default '' check (length(reason) <= 500),
  created_at   timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports: file own" on public.reports;
drop policy if exists "reports: admin read" on public.reports;
create policy "reports: file own" on public.reports for insert to authenticated with check (reporter = auth.uid());
create policy "reports: admin read" on public.reports for select to authenticated using (public.is_admin());

-- ---------- Daily AI allowance, counted by the server only ----------
create table if not exists public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  kind    text not null check (kind in ('lesson', 'mark', 'other')),
  count   int  not null default 0,
  primary key (user_id, day, kind)
);
alter table public.usage enable row level security;
drop policy if exists "usage: read own" on public.usage;
create policy "usage: read own" on public.usage for select to authenticated using (user_id = auth.uid());

-- Adds one to today's count and returns true, or returns false when the limit is reached.
create or replace function public.bump_usage(p_user uuid, p_kind text, p_limit int) returns boolean
  language plpgsql security definer set search_path = public
  as $$
declare n int;
begin
  insert into public.usage as u (user_id, day, kind, count)
  values (p_user, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = u.count + 1
    where u.count < p_limit
  returning u.count into n;
  return n is not null;
end $$;
revoke all on function public.bump_usage(uuid, text, int) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, text, int) to service_role;

-- Local check of schema.sql's privacy rules against a stand-in for Supabase's auth setup.
\set ON_ERROR_STOP on
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
\i supabase/schema.sql
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
insert into public.admins values ('00000000-0000-0000-0000-00000000000c');
\unset ON_ERROR_STOP

-- A saves a course and shares it
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into docs (col, id, data) values ('courses', 'c1', '{"title":"A private"}');
insert into community (course_id, author_name, data) values ('c1', 'Muiji', '{"title":"A shared"}');
-- B: cannot see A's docs, cannot write as A, can read community, cannot delete A's share
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B sees A docs (want 0): ' || count(*) from docs;
insert into docs (owner, col, id, data) values ('00000000-0000-0000-0000-00000000000a', 'courses', 'evil', '{}');
select 'B sees community (want 1): ' || count(*) from community;
delete from community where course_id = 'c1';
select 'after B delete, community rows (want 1): ' || count(*) from community;
update docs set data = '{}' where id = 'c1';
insert into reports (course_owner, course_id, reason) values ('00000000-0000-0000-0000-00000000000a', 'c1', 'spam');
select 'B reads reports (want 0): ' || count(*) from reports;
select 'B bump_usage (want error):'; select bump_usage('00000000-0000-0000-0000-00000000000b', 'lesson', 3);
insert into usage values ('00000000-0000-0000-0000-00000000000b', current_date, 'lesson', -100);
-- anon sees nothing
reset request.jwt.claim.sub; set role anon;
select 'anon community:'; select count(*) from community;
-- C (admin) can read reports and remove the share
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select 'admin reads reports (want 1): ' || count(*) from reports;
delete from community where course_id = 'c1';
select 'after admin delete (want 0): ' || count(*) from community;
-- server counts usage
reset role; set role service_role;
select 'bump x4 (want t,t,t,f): ' || string_agg(bump_usage('00000000-0000-0000-0000-00000000000b', 'lesson', 3)::text, ',') from generate_series(1,4);
select 'A docs still intact: ' || (data->>'title') from docs where id = 'c1';

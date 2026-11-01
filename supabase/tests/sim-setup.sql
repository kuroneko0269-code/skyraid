-- 手元の Postgres で Supabase のロールと auth を模す（テスト専用。本番では流さない）。
-- スーパーユーザー（supabase_admin）で、空のデータベースに流す。postgres は BYPASSRLS の無いロールにしておくこと（run.sh の説明）
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
end $$;
grant anon, authenticated to postgres;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb
);
-- PostgREST が入れる request.jwt.claims を読む（Supabase の auth.uid() / auth.jwt() と同じ形）
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, postgres;
grant execute on all functions in schema auth to anon, authenticated, postgres;
grant select, update on auth.users to postgres;


-- 7-4d: 承認前のユーザーが join_requests に申請できること・他人の行が見えないこと・README の owner 付与の SQL を、
-- Supabase のロールを模した手元の Postgres で確かめる（run.sh から流す。本番では流さない）。
-- スーパーユーザーで流し、各ケースは set local role authenticated + request.jwt.claims で PostgREST と同じ状態にする
\set ON_ERROR_STOP 1
\set QUIET 1

begin;
delete from skyraid.join_requests where user_id in (
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
  'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000004');
delete from auth.users where email like '%@sim.test';
-- A・B: 承認前（apps に skyraid が無い。B はトークンに app_metadata 自体が無い）。O: owner（roles 階層が無い状態から付与）
insert into auth.users (id, email, raw_app_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@sim.test', '{"provider":"email","providers":["email"]}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'b@sim.test', null),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'o@sim.test', '{"provider":"email","apps":["other"]}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'n@sim.test', '{"apps":["other"],"roles":{"other":"admin"}}');
commit;

-- PostgREST の upsert（resolution=ignore-duplicates）と同じ形の insert
create or replace function pg_temp.pgrst_join(body json) returns bigint language sql as $$
  with pgrst_source as (
    insert into skyraid.join_requests (display_name, user_id)
    select b.display_name, b.user_id from json_to_recordset(body) as b(display_name text, user_id uuid)
    on conflict (user_id) do nothing returning 1)
  select count(*) from pgrst_source
$$;

-- 1. 承認前の A は自分の行を insert でき、読める
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"provider":"email"}}', true);
do $$ begin
  assert not skyraid.has_app_access(), 'A は承認前';
  assert pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","display_name":"ACE ✈️ 🛩️"}]') = 1, 'A の申請が入る';
  assert pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000001","display_name":"AGAIN"}]') = 0, '2 回目は何もしない';
  assert (select status from skyraid.join_requests where user_id = auth.uid()) = 'pending', 'A は自分の行を読める';
  assert (select display_name from skyraid.join_requests where user_id = auth.uid()) = 'ACE ✈️ 🛩️', '絵文字の名前も入る';
end $$;
commit;

-- 2. app_metadata の無いトークンの B も申請できる。A の行は見えない。他人の user_id・approved では入れない
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$ begin
  assert pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000002","display_name":"PILOT"}]') = 1, 'B の申請が入る';
  assert (select count(*) from skyraid.join_requests) = 1, 'B には自分の行だけ見える';
  assert not exists (select 1 from skyraid.join_requests where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'A の行は見えない';
  begin
    perform pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000003","display_name":"FAKE"}]');
    assert false, '他人の user_id では入れない';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into skyraid.join_requests (user_id, display_name, status) values (auth.uid(), 'X', 'approved');
    assert false, 'approved では入れない';
  exception when insufficient_privilege or unique_violation then null;
  end;
end $$;
commit;

-- 3. 表示名の check: 空・17 文字は 23514（クライアントは既定の名前 PILOT で送り直す）。16 文字の絵文字は入る
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$ begin
  begin
    perform pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000003","display_name":""}]');
    assert false, '空の名前は入らない';
  exception when check_violation then null;
  end;
  begin
    perform pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000003","display_name":"12345678901234567"}]');
    assert false, '17 文字は入らない';
  exception when check_violation then null;
  end;
  assert pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000003","display_name":"🛩️🛩️🛩️🛩️🛩️🛩️🛩️🛩️"}]') = 1, '16 コードポイントの絵文字は入る';
end $$;
rollback;

-- 4. anon は申請できない（セッション確立前に送っても入らない）
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  perform pg_temp.pgrst_join('[{"user_id":"aaaaaaaa-0000-0000-0000-000000000004","display_name":"ANON"}]');
  assert false, 'anon は入れない';
exception when insufficient_privilege then null;
end $$;
rollback;

-- 5. README の owner 付与の SQL（roles 階層が無くても付く。他アプリの値は残る）
begin;
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb), '{apps}',
  (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
     from jsonb_array_elements_text(coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || '["skyraid"]'::jsonb) v))
where email in ('o@sim.test', 'n@sim.test');
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb), '{roles}',
  coalesce(raw_app_meta_data -> 'roles', '{}'::jsonb) || '{"skyraid": "owner"}'::jsonb, true)
where email in ('o@sim.test', 'n@sim.test');
do $$ begin
  assert (select raw_app_meta_data from auth.users where email = 'o@sim.test')
    = '{"provider":"email","apps":["other","skyraid"],"roles":{"skyraid":"owner"}}'::jsonb, 'roles が無くても owner が付く';
  assert (select raw_app_meta_data from auth.users where email = 'n@sim.test')
    = '{"apps":["other","skyraid"],"roles":{"other":"admin","skyraid":"owner"}}'::jsonb, '他アプリの roles は残る';
end $$;
commit;

-- 6. owner は全員の申請を list_members で見られる（A・B が承認待ちに載る）
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"apps":["other","skyraid"],"roles":{"skyraid":"owner"}}}', true);
do $$ begin
  assert (select count(*) from skyraid.list_members() where status = 'pending'
          and user_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002')) = 2,
    'owner の一覧に承認待ちの 2 人が出る';
  assert (select count(*) from skyraid.join_requests) >= 2, 'owner は全行を読める';
end $$;
commit;

\echo 'join-requests.sql: all assertions passed'

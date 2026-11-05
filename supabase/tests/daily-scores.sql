-- 9-9: 日替わりチャレンジのスコア（skyraid_0005_daily.sql）を、Supabase のロールを模した手元の Postgres で確かめる
-- （run.sh から流す。本番では流さない）。メンバーだけが送れる・読める、本人の行だけ、値の範囲・日付の範囲・
-- 間引き（ユーザー × 日 × 条件ごとに最良 1 件）・ランキングの順（的の課題は大きい順、レースは小さい順）・anon は何もできない
\set ON_ERROR_STOP 1
\set QUIET 1

begin;
delete from skyraid.daily_scores;
delete from skyraid.profiles where user_id in (
  'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002');
insert into skyraid.profiles (user_id, display_name) values
  ('dddddddd-0000-0000-0000-000000000001', 'ACE'),
  ('dddddddd-0000-0000-0000-000000000002', 'BOB');
commit;

-- 1. メンバーの A は自分のスコアを送れる。値・日付・形の外れは拒否
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"apps":["skyraid"]}}', true);
do $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
    values (today, '1:targets:2:kestrel:day-clear', 'targets', 1200, 'easy', 'kestrel', 'skyraid-web/1');
  insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
    values (today - 6, '1:race:1:swift:night-clear', 'race', 95000, 'hard', 'swift', 'skyraid-web/1');
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values (today - 7, '1:targets:2:kestrel:day-clear', 'targets', 1, 'easy', 'kestrel', 'v');
    assert false, '7 日より前の日は入れない';
  exception when check_violation then null;
  end;
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values (today + 2, '1:targets:2:kestrel:day-clear', 'targets', 1, 'easy', 'kestrel', 'v');
    assert false, '2 日先の日は入れない';
  exception when check_violation then null;
  end;
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values (today, '1:targets:2:kestrel:day-clear', 'targets', 50001, 'easy', 'kestrel', 'v');
    assert false, 'スコアの上限';
  exception when check_violation then null;
  end;
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values (today, '1:race:2:kestrel:day-clear', 'race', 27853, 'easy', 'kestrel', 'v');
    assert false, 'レースの下限';
  exception when check_violation then null;
  end;
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values (today, '1:race:2:kestrel:day-clear', 'targets', 10, 'easy', 'kestrel', 'v');
    assert false, '見出しと種類が合わない';
  exception when check_violation then null;
  end;
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values (today, '1:targets:2:kestrel:day-clear', 'targets', 10, 'auto', 'kestrel', 'v');
    assert false, '補助の組の外';
  exception when check_violation then null;
  end;
  begin
    insert into skyraid.daily_scores (user_id, day, spec, kind, value, preset, aircraft_id, client_version)
      values ('dddddddd-0000-0000-0000-000000000002', today, '1:targets:2:kestrel:day-clear', 'targets', 10, 'easy', 'kestrel', 'v');
    assert false, '他人の行は入れない';
  exception when insufficient_privilege then null;
  end;
  begin
    update skyraid.daily_scores set value = 1;
    assert false, 'update できない';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- 2. 承認前の C は送れない・読めない
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"apps":["other"]}}', true);
do $$ begin
  assert (select count(*) from skyraid.daily_best) = 0, '承認前はランキングが見えない';
  begin
    insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
      values ((now() at time zone 'Asia/Tokyo')::date, '1:targets:2:kestrel:day-clear', 'targets', 10, 'easy', 'kestrel', 'v');
    assert false, '承認前は送れない';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

-- 3. 間引き（1 分より前の行を残さない）とランキングの順。所有者で古い時刻の行を入れてから B が送る
begin;
alter table skyraid.daily_scores disable trigger daily_scores_before_insert;
insert into skyraid.daily_scores (user_id, day, spec, kind, value, preset, aircraft_id, client_version, created_at) values
  ('dddddddd-0000-0000-0000-000000000002', (now() at time zone 'Asia/Tokyo')::date, '1:targets:2:kestrel:day-clear', 'targets', 900, 'normal', 'kestrel', 'v', now() - interval '10 minutes'),
  ('dddddddd-0000-0000-0000-000000000002', (now() at time zone 'Asia/Tokyo')::date, '1:targets:2:kestrel:day-clear', 'targets', 1500, 'hard', 'kestrel', 'v', now() - interval '9 minutes'),
  ('dddddddd-0000-0000-0000-000000000002', (now() at time zone 'Asia/Tokyo')::date - 20, '1:targets:2:kestrel:day-clear', 'targets', 1, 'hard', 'kestrel', 'v', now() - interval '20 days');
alter table skyraid.daily_scores enable trigger daily_scores_before_insert;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"apps":["skyraid"]}}', true);
insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
  values ((now() at time zone 'Asia/Tokyo')::date, '1:targets:2:kestrel:day-clear', 'targets', 1000, 'easy', 'kestrel', 'v');
do $$ begin
  -- 古い 2 行は最良（1500）だけ残り、今送った行（1 分以内）は残る。20 日前の行は消える
  assert (select count(*) from skyraid.daily_scores where user_id = auth.uid()) = 2, '間引き';
  assert (select max(value) from skyraid.daily_scores where user_id = auth.uid()) = 1500, '最良が残る';
  assert not exists (select 1 from skyraid.daily_scores where user_id = auth.uid() and day < (now() at time zone 'Asia/Tokyo')::date - 7), '古い日は消える';
  -- ランキング: 的の課題は大きい順。B は最良の 1500 で 1 位、A は 1200 で 2 位
  assert (select display_name from skyraid.daily_best where spec = '1:targets:2:kestrel:day-clear' and place = 1) = 'BOB', 'B が 1 位';
  assert (select value from skyraid.daily_best where spec = '1:targets:2:kestrel:day-clear' and display_name = 'ACE') = 1200, 'A は 1200';
  assert (select count(*) from skyraid.daily_best where spec = '1:targets:2:kestrel:day-clear') = 2, '1 人 1 行';
end $$;
commit;

-- 4. レースは小さい順
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"apps":["skyraid"]}}', true);
insert into skyraid.daily_scores (day, spec, kind, value, preset, aircraft_id, client_version)
  values ((now() at time zone 'Asia/Tokyo')::date - 6, '1:race:1:swift:night-clear', 'race', 99000, 'custom', 'swift', 'v');
do $$ begin
  assert (select display_name from skyraid.daily_best where spec = '1:race:1:swift:night-clear' and place = 1) = 'ACE', 'タイムの短い A が 1 位';
end $$;
commit;

-- 5. anon は表もビューも読めない
begin;
set local role anon;
do $$ begin
  begin
    perform 1 from skyraid.daily_scores;
    assert false, 'anon は表を読めない';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from skyraid.daily_best;
    assert false, 'anon はビューを読めない';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

begin;
delete from skyraid.daily_scores;
commit;
\echo 'daily-scores.sql: all assertions passed'

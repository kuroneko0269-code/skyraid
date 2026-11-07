-- 10-2: レイドの記録のキーの決まり（skyraid_0006_raid_key_rule.sql）を、Supabase のロールを模した手元の Postgres で確かめる
-- （run.sh から流す。本番では流さない）。ヴォルガスの 'normal'・'hard'、「怪獣の id:難易度」の形は通り、形の外れは拒否
\set ON_ERROR_STOP 1
\set QUIET 1

begin;
do $$
declare
  ok text[] := array['normal', 'hard', 'nephirga:normal', 'nephirga:hard', 'albion:hard', 'gourai-2:normal'];
  bad text[] := array['easy', 'nephirga', 'nephirga:easy', ':normal', 'a:normal', 'Albion:normal', '9x:normal',
    'albion:normal:x', 'albion_x:normal', 'abcdefghijklmnopqrstuvwxy:normal'];
  k text;
begin
  foreach k in array ok loop
    insert into skyraid.records (user_id, kind, key, aircraft_id, value_ms, client_version)
      values ('eeeeeeee-0000-0000-0000-000000000001', 'raid', k, 'kestrel', 300000, 'skyraid-web/1');
  end loop;
  foreach k in array bad loop
    begin
      insert into skyraid.records (user_id, kind, key, aircraft_id, value_ms, client_version)
        values ('eeeeeeee-0000-0000-0000-000000000001', 'raid', k, 'kestrel', 300000, 'skyraid-web/1');
      assert false, format('レイドの key %s は通らない', k);
    exception when check_violation then null;
    end;
  end loop;
  -- 形が合っても、レースの key はレースの一覧だけ（0004 のまま）
  begin
    insert into skyraid.records (user_id, kind, key, aircraft_id, value_ms, client_version)
      values ('eeeeeeee-0000-0000-0000-000000000001', 'race', 'albion:normal', 'kestrel', 300000, 'skyraid-web/1');
    assert false, 'レースの key は決まりでは通らない';
  exception when check_violation then null;
  end;
end $$;
rollback;

\echo 'raid-key-rule.sql: all assertions passed'

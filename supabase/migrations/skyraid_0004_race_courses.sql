-- SkyRaid（9-8）: リングレースの記録に新しいコース 2 本（夜景クルーズ 'night-harbor'・峰のらせん 'peak-spiral'）を足す。
-- 規約: docs/supabase-conventions.md（v1.0）。設計: docs/supabase-design.md
-- 流し方: skyraid_0001_init.sql・skyraid_0002_members.sql・skyraid_0003_raid_kaiju.sql の後に、ダッシュボードの SQL エディタで
-- このファイル全体を実行する（何度流しても同じ結果。途中で失敗したら何も変わらない）。変えるのは skyraid.records の
-- key の check（レースの key に 2 本を足す。レイド・防衛戦は 0003 のまま）と、レースの下限の check（新しいコースの値を足す。
-- 今のコースの値は 0001 のまま）だけ。今の行はそのまま通る。ビュー race_best は key ごとに順位を付けるので変えない。
-- 下限の値は src/online/records.ts の raceFloorMs と同じ（tests/race-courses-sql.test.ts で突き合わせる）
begin;

alter table skyraid.records drop constraint if exists records_key;
alter table skyraid.records add constraint records_key check (
  (kind = 'race' and key in ('coast', 'canyon', 'harbor-speed', 'acro', 'night-harbor', 'peak-spiral'))
  or (kind = 'raid' and key in ('normal', 'hard', 'nephirga:normal', 'nephirga:hard'))
  or (kind = 'defense' and key in ('island:normal', 'island:hard', 'harbor:normal', 'harbor:hard'))
);

alter table skyraid.records drop constraint if exists records_race_floor;
alter table skyraid.records add constraint records_race_floor check (
  kind <> 'race' or value_ms >= case key
    when 'coast' then 13927
    when 'canyon' then 7848
    when 'harbor-speed' then 5936
    when 'acro' then 7187
    when 'night-harbor' then 10556
    when 'peak-spiral' then 10834
    else 2147483647 end
);

insert into skyraid.schema_migrations (version) values ('skyraid_0004_race_courses') on conflict do nothing;

commit;

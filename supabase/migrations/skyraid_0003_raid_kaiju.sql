-- SkyRaid（9-6c）: レイドの記録に怪獣ネフィルガを足す（ランキングを怪獣ごとに分ける）。
-- 規約: docs/supabase-conventions.md（v1.0）。設計: docs/supabase-design.md
-- 流し方: skyraid_0001_init.sql・skyraid_0002_members.sql の後に、ダッシュボードの SQL エディタでこのファイル全体を実行する
-- （何度流しても同じ結果。途中で失敗したら何も変わらない）。変えるのは skyraid.records の key の check だけ:
-- レイドの key に 'nephirga:normal'・'nephirga:hard' を足す（ヴォルガスは今までどおり 'normal'・'hard'。今の行はそのまま通る）。
-- ビュー raid_best は key ごとに分けて順位を付けるので変えない
begin;

alter table skyraid.records drop constraint if exists records_key;
alter table skyraid.records add constraint records_key check (
  (kind = 'race' and key in ('coast', 'canyon', 'harbor-speed', 'acro'))
  or (kind = 'raid' and key in ('normal', 'hard', 'nephirga:normal', 'nephirga:hard'))
  or (kind = 'defense' and key in ('island:normal', 'island:hard', 'harbor:normal', 'harbor:hard'))
);

insert into skyraid.schema_migrations (version) values ('skyraid_0003_raid_kaiju') on conflict do nothing;

commit;

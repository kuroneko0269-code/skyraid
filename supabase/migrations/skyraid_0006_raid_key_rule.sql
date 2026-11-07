-- SkyRaid（10-2）: レイドの記録のキーを「決まり」で受け付ける（怪獣を足すたびに SQL を流さなくて済むように）。
-- 規約: docs/supabase-conventions.md（v1.0）。設計: docs/supabase-design.md
-- 流し方: skyraid_0001〜0005 の後に、ダッシュボードの SQL エディタでこのファイル全体を実行する（何度流しても同じ結果。
-- 途中で失敗したら何も変わらない）。変えるのは skyraid.records の key の check だけ:
-- レイドの key は、ヴォルガスの 'normal'・'hard'（7-4 からの記録のまま）か、「怪獣の id:難易度」の形
-- （id は英小文字で始まる英小文字・数字・- の 2〜24 文字、難易度は normal / hard。src/data/raid-kaiju.ts の RAID_KEY_PATTERN と同じ）。
-- 'nephirga:normal'・'nephirga:hard'（0003）もこの形なので、今の行はそのまま通る。レース・防衛戦は 0004 のまま。
-- ビュー raid_best は key ごとに分けて順位を付けるので変えない。流した後にゲームの src/data/online.ts の
-- RAID_KEY_RULE_ENABLED を true にする（README の「レイドの記録のキーの決まり」）
begin;

alter table skyraid.records drop constraint if exists records_key;
alter table skyraid.records add constraint records_key check (
  (kind = 'race' and key in ('coast', 'canyon', 'harbor-speed', 'acro', 'night-harbor', 'peak-spiral'))
  or (kind = 'raid' and (key in ('normal', 'hard') or key ~ '^[a-z][a-z0-9-]{1,23}:(normal|hard)$'))
  or (kind = 'defense' and key in ('island:normal', 'island:hard', 'harbor:normal', 'harbor:hard'))
);

insert into skyraid.schema_migrations (version) values ('skyraid_0006_raid_key_rule') on conflict do nothing;

commit;

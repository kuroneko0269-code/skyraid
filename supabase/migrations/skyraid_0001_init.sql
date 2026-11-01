-- SkyRaid（7-4）: クラウドセーブとメンバー内ランキング。
-- 規約: docs/supabase-conventions.md（Supabase 共有プロジェクトの規約 v1.0）。設計: docs/supabase-design.md
-- 流し方: ダッシュボードの SQL エディタでこのファイル全体を実行する（何度流しても同じ結果。途中で失敗したら何も変わらない）。
-- 触れるのはスキーマ skyraid の中だけ（public・auth・storage にはオブジェクトを作らない）
begin;

-- ---------------------------------------------------------------- 1. スキーマと権限の既定値（規約 1.1 / 1.3）
create schema if not exists skyraid;

grant usage on schema skyraid to anon, authenticated;
-- 関数は明示して与えたものだけ呼べるようにする（in schema skyraid 付き。付けないと他アプリのスキーマにも効く）
alter default privileges in schema skyraid revoke execute on functions from public;
-- 注: Postgres の仕様で、スキーマ指定の既定値は全体の既定値（関数の execute を public に与える）を取り消せない。
-- そのため、下の関数はすべて個別に revoke all ... from public もしている

comment on schema skyraid is 'SkyRaid: Titan Skies — 3D フライトシューティングのクラウドセーブとメンバー内ランキング / 管理: https://github.com/kuroneko0269-code/skyraid / 規約 v1.0';

-- 適用の記録（規約 4.2。ポリシーなし = API からは見えない）
create table if not exists skyraid.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
alter table skyraid.schema_migrations enable row level security;
alter table skyraid.schema_migrations force row level security;
revoke all on table skyraid.schema_migrations from anon, authenticated;
-- force の RLS は所有者にも効く（postgres に BYPASSRLS がない場合）。このファイルを流す postgres だけが読み書きできるようにする。
-- postgres は API から使われないロール（API は anon / authenticated で動く）なので、API からは見えないまま
drop policy if exists schema_migrations_postgres_select on skyraid.schema_migrations;
create policy schema_migrations_postgres_select on skyraid.schema_migrations for select to postgres
  using (true);
drop policy if exists schema_migrations_postgres_insert on skyraid.schema_migrations;
create policy schema_migrations_postgres_insert on skyraid.schema_migrations for insert to postgres
  with check (true);

-- ---------------------------------------------------------------- 2. アプリの権限の確認（規約 3.3。API には公開しない）
create or replace function skyraid.has_app_access()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'apps') ? 'skyraid', false)
$$;
revoke all on function skyraid.has_app_access() from public;
revoke all on function skyraid.has_app_access() from anon;
grant execute on function skyraid.has_app_access() to authenticated;  -- ポリシーの評価に要る

-- ---------------------------------------------------------------- 3. テーブル
-- 表示名（メールは置かない。auth.users への外部キーも張らない: auth のテーブルに触れないため）
create table if not exists skyraid.profiles (
  user_id uuid primary key default auth.uid(),
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 16),
  constraint profiles_display_name_chars check (display_name !~ '[[:cntrl:]]' and display_name = btrim(display_name))
);

-- セーブ（ローカルのセーブが正。ここはバックアップ）。1 ユーザー 1 行
create table if not exists skyraid.saves (
  user_id uuid primary key default auth.uid(),
  version int not null,
  data jsonb not null,
  size_bytes int not null default 0,
  updated_at timestamptz not null default now(),
  constraint saves_version_range check (version between 1 and 1000),
  constraint saves_data_object check (jsonb_typeof(data) = 'object'),
  constraint saves_data_size check (octet_length(data::text) <= 262144)
);

-- 記録。value_ms は小さいほど良い（防衛戦は detail の waves・hq が先）。不正値は check で拒否する
create table if not exists skyraid.records (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  kind text not null,
  key text not null,
  aircraft_id text not null,
  value_ms int not null,
  detail jsonb not null default '{}'::jsonb,
  client_version text not null,
  created_at timestamptz not null default now(),
  constraint records_kind check (kind in ('race', 'raid', 'defense')),
  constraint records_key check (
    (kind = 'race' and key in ('coast', 'canyon', 'harbor-speed', 'acro'))
    or (kind = 'raid' and key in ('normal', 'hard'))
    or (kind = 'defense' and key in ('island:normal', 'island:hard', 'harbor:normal', 'harbor:hard'))
  ),
  constraint records_aircraft_id check (aircraft_id ~ '^[a-z0-9-]{1,32}$'),
  constraint records_value_range check (value_ms between 1 and 3600000),
  constraint records_client_version check (char_length(client_version) between 1 and 32),
  constraint records_detail check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 1024),
  -- レース: コースの理論最短（最速の機体の速度の上限で全区間を直線で飛び、細いリングのボーナスを全部引いた値）× 0.5 未満を拒否。
  -- 値は src/online/records.ts の raceFloorMs と同じ（tests/online-sql.test.ts で突き合わせる）
  constraint records_race_floor check (
    kind <> 'race' or value_ms >= case key
      when 'coast' then 13927
      when 'canyon' then 7848
      when 'harbor-speed' then 5936
      when 'acro' then 7187
      else 2147483647 end
  ),
  -- 防衛戦: クリアした波は 0〜10（11 波以上を拒否）、司令部の残りは 0〜100 %
  constraint records_defense_detail check (
    kind <> 'defense' or (
      case when detail ->> 'waves' ~ '^[0-9]{1,2}$' then (detail ->> 'waves')::int <= 10 else false end
      and case when detail ->> 'hq' ~ '^[0-9]{1,3}$' then (detail ->> 'hq')::int <= 100 else false end
    )
  )
);

create index if not exists records_ranking_idx on skyraid.records (kind, key, aircraft_id, value_ms);
create index if not exists records_user_idx on skyraid.records (user_id, kind, key, created_at);

-- ---------------------------------------------------------------- 4. トリガ
-- updated_at（とセーブの大きさ）はサーバーで決める
create or replace function skyraid.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_table_name = 'saves' then
    new.size_bytes := octet_length(new.data::text);
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
  end if;
  return new;
end $$;
revoke all on function skyraid.touch_updated_at() from public;
revoke all on function skyraid.touch_updated_at() from anon, authenticated;

drop trigger if exists profiles_touch on skyraid.profiles;
create trigger profiles_touch before insert or update on skyraid.profiles
  for each row execute function skyraid.touch_updated_at();
drop trigger if exists saves_touch on skyraid.saves;
create trigger saves_touch before insert or update on skyraid.saves
  for each row execute function skyraid.touch_updated_at();

-- 記録の順位の並び（小さいほど良い）: 防衛戦は波の多さ・司令部の残りが先、どれも次に value_ms の短さ
create or replace function skyraid.record_sort_key(p_kind text, p_detail jsonb)
returns int language sql immutable set search_path = '' as $$
  select case when p_kind = 'defense'
    then -(coalesce((p_detail ->> 'waves')::int, 0) * 1000 + coalesce((p_detail ->> 'hq')::int, 0))
    else 0 end
$$;
revoke all on function skyraid.record_sort_key(text, jsonb) from public;
revoke all on function skyraid.record_sort_key(text, jsonb) from anon;
grant execute on function skyraid.record_sort_key(text, jsonb) to authenticated;  -- ビューの評価に要る

-- レート制限: 1 ユーザー 1 分 20 行。作成時刻はサーバーの時刻にする
-- security definer: 間引きで消えた行も含めて数えられるよう、ユーザーの権限ではなく所有者の権限で読む
create or replace function skyraid.records_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_at := now();
  if (
    select count(*) from skyraid.records r
    where r.user_id = new.user_id and r.created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'skyraid: rate limit (20 records per minute)' using errcode = 'P0001', hint = 'rate_limit';
  end if;
  return new;
end $$;
revoke all on function skyraid.records_before_insert() from public;
revoke all on function skyraid.records_before_insert() from anon, authenticated;

-- 間引き: kind × key × ユーザー（レースは機体も。ランキングがコース × 機体のため）ごとに最良 3 件だけ残す。
-- 直近 1 分の行はレート制限で数えるため残し、次の送信のときに消す（容量の上限: 1 ユーザー最大 66 行 + 20 行）
create or replace function skyraid.records_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from skyraid.records r
  where r.user_id = new.user_id and r.kind = new.kind and r.key = new.key
    and (new.kind <> 'race' or r.aircraft_id = new.aircraft_id)
    and r.created_at < now() - interval '1 minute'
    and r.id not in (
      select k.id from skyraid.records k
      where k.user_id = new.user_id and k.kind = new.kind and k.key = new.key
        and (new.kind <> 'race' or k.aircraft_id = new.aircraft_id)
      order by skyraid.record_sort_key(k.kind, k.detail), k.value_ms, k.created_at, k.id
      limit 3
    );
  return null;
end $$;
revoke all on function skyraid.records_after_insert() from public;
revoke all on function skyraid.records_after_insert() from anon, authenticated;

drop trigger if exists records_before_insert on skyraid.records;
create trigger records_before_insert before insert on skyraid.records
  for each row execute function skyraid.records_before_insert();
drop trigger if exists records_after_insert on skyraid.records;
create trigger records_after_insert after insert on skyraid.records
  for each row execute function skyraid.records_after_insert();

-- ---------------------------------------------------------------- 5. RLS（全テーブルで enable と force。規約 3.1）
alter table skyraid.profiles enable row level security;
alter table skyraid.profiles force row level security;
alter table skyraid.saves enable row level security;
alter table skyraid.saves force row level security;
alter table skyraid.records enable row level security;
alter table skyraid.records force row level security;

-- テーブルの権限は 1 つずつ（anon には与えない。delete はどのテーブルも与えない）
revoke all on table skyraid.profiles, skyraid.saves, skyraid.records from anon;
revoke all on table skyraid.profiles, skyraid.saves, skyraid.records from authenticated;
grant select, insert, update on table skyraid.profiles to authenticated;
grant select, insert, update on table skyraid.saves to authenticated;
grant select, insert on table skyraid.records to authenticated;

-- profiles: 表示名はメンバー全員が読める（ランキングに出すため）。書けるのは本人だけ
drop policy if exists profiles_authenticated_select on skyraid.profiles;
create policy profiles_authenticated_select on skyraid.profiles for select to authenticated
  using ((select skyraid.has_app_access()));
drop policy if exists profiles_authenticated_insert on skyraid.profiles;
create policy profiles_authenticated_insert on skyraid.profiles for insert to authenticated
  with check ((select skyraid.has_app_access()) and user_id = (select auth.uid()));
drop policy if exists profiles_authenticated_update on skyraid.profiles;
create policy profiles_authenticated_update on skyraid.profiles for update to authenticated
  using ((select skyraid.has_app_access()) and user_id = (select auth.uid()))
  with check ((select skyraid.has_app_access()) and user_id = (select auth.uid()));

-- saves: 本人だけ select / insert / update（delete 不可）
drop policy if exists saves_authenticated_select on skyraid.saves;
create policy saves_authenticated_select on skyraid.saves for select to authenticated
  using ((select skyraid.has_app_access()) and user_id = (select auth.uid()));
drop policy if exists saves_authenticated_insert on skyraid.saves;
create policy saves_authenticated_insert on skyraid.saves for insert to authenticated
  with check ((select skyraid.has_app_access()) and user_id = (select auth.uid()));
drop policy if exists saves_authenticated_update on skyraid.saves;
create policy saves_authenticated_update on skyraid.saves for update to authenticated
  using ((select skyraid.has_app_access()) and user_id = (select auth.uid()))
  with check ((select skyraid.has_app_access()) and user_id = (select auth.uid()));

-- records: 本人が insert、メンバー全員が select（update / delete 不可）
drop policy if exists records_authenticated_select on skyraid.records;
create policy records_authenticated_select on skyraid.records for select to authenticated
  using ((select skyraid.has_app_access()));
drop policy if exists records_authenticated_insert on skyraid.records;
create policy records_authenticated_insert on skyraid.records for insert to authenticated
  with check ((select skyraid.has_app_access()) and user_id = (select auth.uid()));

-- 上の 2 つのトリガ（security definer = 所有者の postgres で動く）が force の RLS の下でも数え・消せるようにする。
-- postgres は API から使われないロール（API は anon / authenticated で動く）なので、利用者には効かない
drop policy if exists records_postgres_select on skyraid.records;
create policy records_postgres_select on skyraid.records for select to postgres using (true);
drop policy if exists records_postgres_delete on skyraid.records;
create policy records_postgres_delete on skyraid.records for delete to postgres using (true);

-- ---------------------------------------------------------------- 6. ランキングのビュー（security invoker: 見る人の RLS を通す）
-- レース: コース × 機体ごとに、ユーザーごとの最速 1 本、上位 100
create or replace view skyraid.race_best with (security_invoker = true) as
with best as (
  select distinct on (r.key, r.aircraft_id, r.user_id)
    r.key, r.aircraft_id, r.user_id, r.value_ms, r.detail, r.created_at
  from skyraid.records r
  where r.kind = 'race'
  order by r.key, r.aircraft_id, r.user_id, r.value_ms, r.created_at
), ranked as (
  select b.*,
    rank() over (partition by b.key, b.aircraft_id order by b.value_ms) as place,
    row_number() over (partition by b.key, b.aircraft_id order by b.value_ms, b.created_at) as n
  from best b
)
select x.key, x.aircraft_id, x.user_id, p.display_name, x.value_ms, x.detail, x.created_at, x.place
from ranked x
left join skyraid.profiles p on p.user_id = x.user_id
where x.n <= 100;

-- レイド: 難易度ごとに、ユーザーごとの最速の撃破 1 本、上位 100
create or replace view skyraid.raid_best with (security_invoker = true) as
with best as (
  select distinct on (r.key, r.user_id)
    r.key, r.aircraft_id, r.user_id, r.value_ms, r.detail, r.created_at
  from skyraid.records r
  where r.kind = 'raid'
  order by r.key, r.user_id, r.value_ms, r.created_at
), ranked as (
  select b.*,
    rank() over (partition by b.key order by b.value_ms) as place,
    row_number() over (partition by b.key order by b.value_ms, b.created_at) as n
  from best b
)
select x.key, x.aircraft_id, x.user_id, p.display_name, x.value_ms, x.detail, x.created_at, x.place
from ranked x
left join skyraid.profiles p on p.user_id = x.user_id
where x.n <= 100;

-- 防衛戦: マップ × 難易度ごとに、ユーザーごとの最良 1 本（波の多さ → 司令部の残り → 時間の短さ）、上位 100
create or replace view skyraid.defense_best with (security_invoker = true) as
with best as (
  select distinct on (r.key, r.user_id)
    r.key, r.aircraft_id, r.user_id, r.value_ms, r.detail, r.created_at,
    skyraid.record_sort_key(r.kind, r.detail) as sort_key
  from skyraid.records r
  where r.kind = 'defense'
  order by r.key, r.user_id, skyraid.record_sort_key(r.kind, r.detail), r.value_ms, r.created_at
), ranked as (
  select b.*,
    rank() over (partition by b.key order by b.sort_key, b.value_ms) as place,
    row_number() over (partition by b.key order by b.sort_key, b.value_ms, b.created_at) as n
  from best b
)
select x.key, x.aircraft_id, x.user_id, p.display_name, x.value_ms, x.detail, x.created_at, x.place
from ranked x
left join skyraid.profiles p on p.user_id = x.user_id
where x.n <= 100;

revoke all on table skyraid.race_best, skyraid.raid_best, skyraid.defense_best from anon;
grant select on table skyraid.race_best, skyraid.raid_best, skyraid.defense_best to authenticated;

-- ---------------------------------------------------------------- 7. 適用の記録
insert into skyraid.schema_migrations (version) values ('skyraid_0001_init') on conflict do nothing;

commit;

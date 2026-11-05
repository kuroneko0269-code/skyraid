-- SkyRaid（9-9）: 日替わりチャレンジのメンバー内ランキング（その日のスコア）。
-- 規約: docs/supabase-conventions.md（v1.0）。設計: docs/supabase-design.md
-- 流し方: skyraid_0001_init.sql〜skyraid_0004_race_courses.sql の後に、ダッシュボードの SQL エディタでこのファイル全体を実行する
-- （何度流しても同じ結果。途中で失敗したら何も変わらない）。作るのはスキーマ skyraid の中のテーブル daily_scores・トリガ 2 つ・
-- ビュー daily_best だけ（records・saves・profiles・join_requests は変えない）。
-- 値の範囲は src/data/daily.ts・src/online/daily-scores.ts と同じ（tests/daily-sql.test.ts で突き合わせる）
begin;

-- ---------------------------------------------------------------- 1. テーブル
-- 1 行 = 1 回の送信（クライアントは日ごとの最高だけを送る）。間引きで 1 ユーザー × 日 × 条件ごとに最良 1 件だけ残す
create table if not exists skyraid.daily_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  day date not null,
  spec text not null,
  kind text not null,
  value int not null,
  preset text not null,
  aircraft_id text not null,
  client_version text not null,
  created_at timestamptz not null default now(),
  constraint daily_scores_kind check (kind in ('targets', 'drones', 'gauntlet', 'race')),
  -- 条件の見出し: 「版:種類:難しさ:機体:天候」（src/missions/daily/schedule.ts の dailySpecKey）。種類は kind と同じ
  constraint daily_scores_spec check (
    spec ~ '^[0-9]{1,3}:(targets|drones|gauntlet|race):[1-3]:[a-z0-9-]{1,32}:[a-z0-9-]{1,32}$'
    and split_part(spec, ':', 2) = kind
  ),
  constraint daily_scores_preset check (preset in ('easy', 'normal', 'hard', 'custom')),
  constraint daily_scores_aircraft_id check (aircraft_id ~ '^[a-z0-9-]{1,32}$'),
  constraint daily_scores_client_version check (char_length(client_version) between 1 and 32),
  -- 的の課題: スコア 0〜50000（撃墜 ×（100 + 命中率%））。レース: タイム（ミリ秒）。海岸周回の下限 13927 × 2 周以上・1 時間以下
  constraint daily_scores_value check (
    (kind = 'race' and value between 27854 and 3600000)
    or (kind <> 'race' and value between 0 and 50000)
  )
);

create index if not exists daily_scores_ranking_idx on skyraid.daily_scores (day, spec, value);
create index if not exists daily_scores_user_idx on skyraid.daily_scores (user_id, day, created_at);

-- ---------------------------------------------------------------- 2. トリガ
-- 日付の確かめ（日本時間の今日から 6 日前まで。未来の日は 1 日先まで: 端末の時計のずれ）とレート制限（1 ユーザー 1 分 20 行）。
-- 作成時刻はサーバーの時刻にする。security definer: 間引きで消えた行も含めて数えられるよう、所有者の権限で読む
create or replace function skyraid.daily_scores_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  new.created_at := now();
  if new.day < today - 6 or new.day > today + 1 then
    raise exception 'skyraid: daily score is out of date' using errcode = '23514', hint = 'daily_day';
  end if;
  if (
    select count(*) from skyraid.daily_scores d
    where d.user_id = new.user_id and d.created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'skyraid: rate limit (20 daily scores per minute)' using errcode = 'P0001', hint = 'rate_limit';
  end if;
  return new;
end $$;
revoke all on function skyraid.daily_scores_before_insert() from public;
revoke all on function skyraid.daily_scores_before_insert() from anon, authenticated;

-- 間引き: ユーザー × 日 × 条件ごとに最良 1 件（的の課題は大きい順、レースは小さい順）。直近 1 分の行はレート制限で数えるため残す。
-- 8 日より前の行はその人の次の送信で消す（ランキングは 7 日分だけ。容量の上限: 1 ユーザー最大 8 行 + 20 行）
create or replace function skyraid.daily_scores_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from skyraid.daily_scores d
  where d.user_id = new.user_id and d.day < new.day - 7;
  delete from skyraid.daily_scores d
  where d.user_id = new.user_id and d.day = new.day and d.spec = new.spec
    and d.created_at < now() - interval '1 minute'
    and d.id not in (
      select k.id from skyraid.daily_scores k
      where k.user_id = new.user_id and k.day = new.day and k.spec = new.spec
      order by case when k.kind = 'race' then k.value else -k.value end, k.created_at, k.id
      limit 1
    );
  return null;
end $$;
revoke all on function skyraid.daily_scores_after_insert() from public;
revoke all on function skyraid.daily_scores_after_insert() from anon, authenticated;

drop trigger if exists daily_scores_before_insert on skyraid.daily_scores;
create trigger daily_scores_before_insert before insert on skyraid.daily_scores
  for each row execute function skyraid.daily_scores_before_insert();
drop trigger if exists daily_scores_after_insert on skyraid.daily_scores;
create trigger daily_scores_after_insert after insert on skyraid.daily_scores
  for each row execute function skyraid.daily_scores_after_insert();

-- ---------------------------------------------------------------- 3. RLS（enable と force。規約 3.1）
alter table skyraid.daily_scores enable row level security;
alter table skyraid.daily_scores force row level security;

revoke all on table skyraid.daily_scores from anon;
revoke all on table skyraid.daily_scores from authenticated;
grant select, insert on table skyraid.daily_scores to authenticated;

-- 本人が insert、メンバー全員が select（update / delete 不可）
drop policy if exists daily_scores_authenticated_select on skyraid.daily_scores;
create policy daily_scores_authenticated_select on skyraid.daily_scores for select to authenticated
  using ((select skyraid.has_app_access()));
drop policy if exists daily_scores_authenticated_insert on skyraid.daily_scores;
create policy daily_scores_authenticated_insert on skyraid.daily_scores for insert to authenticated
  with check ((select skyraid.has_app_access()) and user_id = (select auth.uid()));

-- トリガ（security definer = 所有者の postgres）が force の RLS の下でも数え・消せるようにする（records と同じ）
drop policy if exists daily_scores_postgres_select on skyraid.daily_scores;
create policy daily_scores_postgres_select on skyraid.daily_scores for select to postgres using (true);
drop policy if exists daily_scores_postgres_delete on skyraid.daily_scores;
create policy daily_scores_postgres_delete on skyraid.daily_scores for delete to postgres using (true);

-- ---------------------------------------------------------------- 4. ランキングのビュー（security invoker: 見る人の RLS を通す）
-- 日 × 条件ごとに、ユーザーごとの最良 1 件、上位 50
create or replace view skyraid.daily_best with (security_invoker = true) as
with best as (
  select distinct on (d.day, d.spec, d.user_id)
    d.day, d.spec, d.kind, d.user_id, d.value, d.preset, d.aircraft_id, d.created_at,
    case when d.kind = 'race' then d.value else -d.value end as sort_value
  from skyraid.daily_scores d
  order by d.day, d.spec, d.user_id, case when d.kind = 'race' then d.value else -d.value end, d.created_at
), ranked as (
  select b.*,
    rank() over (partition by b.day, b.spec order by b.sort_value) as place,
    row_number() over (partition by b.day, b.spec order by b.sort_value, b.created_at) as n
  from best b
)
select x.day, x.spec, x.kind, x.user_id, p.display_name, x.value, x.preset, x.aircraft_id, x.created_at, x.place
from ranked x
left join skyraid.profiles p on p.user_id = x.user_id
where x.n <= 50;

revoke all on table skyraid.daily_best from anon;
grant select on table skyraid.daily_best to authenticated;

insert into skyraid.schema_migrations (version) values ('skyraid_0005_daily') on conflict do nothing;

commit;

-- SkyRaid（7-4b）: メンバー承認のアプリ内管理と、セーブのバックアップの削除。
-- 規約: docs/supabase-conventions.md（v1.0）。設計: docs/supabase-design.md（「規約からの逸脱」節を必ず読む）
-- 流し方: skyraid_0001_init.sql の後に、ダッシュボードの SQL エディタでこのファイル全体を実行する（何度流しても同じ結果。
-- 途中で失敗したら何も変わらない）。作るのはスキーマ skyraid の中だけ。auth.users は承認・取り消しの関数の中で
-- raw_app_meta_data の apps の 'skyraid' だけを足す・除く（規約 3.3 の jsonb の操作のまま。他アプリの値は保持）
begin;

-- ---------------------------------------------------------------- 1. owner の確認（API には公開しない）
-- JWT の app_metadata.roles.skyraid が 'owner' か。app_metadata は利用者が書き換えられない（規約 3.3）。
-- execute は誰にも与えない（下の security definer の関数が所有者の権限で呼ぶだけ）。ポリシーは同じ式を直接書く
create or replace function skyraid.is_owner()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'roles' ->> 'skyraid') = 'owner', false)
$$;
revoke all on function skyraid.is_owner() from public;
revoke all on function skyraid.is_owner() from anon, authenticated;

-- ---------------------------------------------------------------- 2. 承認待ちの一覧（参加の申請）
-- 1 ユーザー 1 行。承認前の人が書くので has_app_access() は確かめない（設計書の「規約からの逸脱」）。
-- メールは置かない。auth.users への外部キーも張らない（auth のテーブルの構造に触れないため）
create table if not exists skyraid.join_requests (
  user_id uuid primary key default auth.uid(),
  display_name text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending',
  constraint join_requests_status check (status in ('pending', 'approved', 'rejected')),
  constraint join_requests_display_name_length check (char_length(display_name) between 1 and 16),
  constraint join_requests_display_name_chars check (display_name !~ '[[:cntrl:]]' and display_name = btrim(display_name))
);

-- 申請の時刻はサーバーで決め、update で user_id・表示名・申請の時刻を変えさせない（owner が変えるのは status だけ）
create or replace function skyraid.join_requests_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.requested_at := now();
  else
    new.user_id := old.user_id;
    new.display_name := old.display_name;
    new.requested_at := old.requested_at;
  end if;
  return new;
end $$;
revoke all on function skyraid.join_requests_touch() from public;
revoke all on function skyraid.join_requests_touch() from anon, authenticated;

drop trigger if exists join_requests_touch on skyraid.join_requests;
create trigger join_requests_touch before insert or update on skyraid.join_requests
  for each row execute function skyraid.join_requests_touch();

alter table skyraid.join_requests enable row level security;
alter table skyraid.join_requests force row level security;
revoke all on table skyraid.join_requests from anon;
revoke all on table skyraid.join_requests from authenticated;
grant select, insert on table skyraid.join_requests to authenticated;
grant update (status) on table skyraid.join_requests to authenticated;

-- 本人: 自分の行だけ insert（承認待ちとしてだけ）と select
drop policy if exists join_requests_authenticated_insert on skyraid.join_requests;
create policy join_requests_authenticated_insert on skyraid.join_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
drop policy if exists join_requests_authenticated_select on skyraid.join_requests;
create policy join_requests_authenticated_select on skyraid.join_requests for select to authenticated
  using (user_id = (select auth.uid())
         or coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles' ->> 'skyraid') = 'owner', false));
-- owner: 全行の status を変えられる（「却下」）。approved にするのは app_metadata も変える承認の関数だけ
drop policy if exists join_requests_authenticated_update on skyraid.join_requests;
create policy join_requests_authenticated_update on skyraid.join_requests for update to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles' ->> 'skyraid') = 'owner', false))
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' -> 'roles' ->> 'skyraid') = 'owner', false)
              and status in ('pending', 'rejected'));

-- 下の関数（security definer = 所有者の postgres で動く）が force の RLS の下でも読み書きできるようにする。
-- postgres は API から使われないロールなので、利用者の権限は広がらない（0001 の records と同じ考え方）
drop policy if exists join_requests_postgres_select on skyraid.join_requests;
create policy join_requests_postgres_select on skyraid.join_requests for select to postgres using (true);
drop policy if exists join_requests_postgres_update on skyraid.join_requests;
create policy join_requests_postgres_update on skyraid.join_requests for update to postgres using (true) with check (true);
drop policy if exists profiles_postgres_select on skyraid.profiles;
create policy profiles_postgres_select on skyraid.profiles for select to postgres using (true);

-- ---------------------------------------------------------------- 3. 承認・取り消し（owner だけ）
-- auth.users の raw_app_meta_data.apps に 'skyraid' を足す。式は規約 3.3 の付与と同じ（他アプリの値は保持）
create or replace function skyraid.approve_member(p_user uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not skyraid.is_owner() then
    raise exception 'skyraid: owner only' using errcode = '42501';
  end if;
  update auth.users
  set raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'::jsonb), '{apps}',
    (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
       from jsonb_array_elements_text(coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || '["skyraid"]'::jsonb) v))
  where id = p_user;
  if not found then
    raise exception 'skyraid: no such user' using errcode = 'P0002';
  end if;
  -- SQL で承認した人など、申請の行が無ければ何もしない（一覧は apps から承認済みと判断する）
  update skyraid.join_requests set status = 'approved' where user_id = p_user;
end $$;
revoke all on function skyraid.approve_member(uuid) from public;
revoke all on function skyraid.approve_member(uuid) from anon;
grant execute on function skyraid.approve_member(uuid) to authenticated;

-- 'skyraid' を除く。式は規約 3.3 の取り消しと同じ。自分自身は取り消せない（管理できなくなるのを防ぐ）
create or replace function skyraid.revoke_member(p_user uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not skyraid.is_owner() then
    raise exception 'skyraid: owner only' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'skyraid: cannot revoke yourself' using errcode = '22023';
  end if;
  update auth.users
  set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{apps}',
    coalesce((raw_app_meta_data -> 'apps') - 'skyraid', '[]'::jsonb))
  where id = p_user;
  if not found then
    raise exception 'skyraid: no such user' using errcode = 'P0002';
  end if;
  update skyraid.join_requests set status = 'rejected' where user_id = p_user;
end $$;
revoke all on function skyraid.revoke_member(uuid) from public;
revoke all on function skyraid.revoke_member(uuid) from anon;
grant execute on function skyraid.revoke_member(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. メンバーの一覧（owner だけ。メールは返さない）
-- 承認済み（apps に skyraid がある。SQL で承認した人も含む）と承認待ち。表示名はプロフィール → 申請の順。
-- 並び: 承認待ち（申請の古い順）→ 承認済み
create or replace function skyraid.list_members()
returns table (user_id uuid, display_name text, status text, requested_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not skyraid.is_owner() then
    raise exception 'skyraid: owner only' using errcode = '42501';
  end if;
  return query
    select x.user_id, x.display_name, x.status, x.requested_at
    from (
      select u.id as user_id,
        coalesce(p.display_name, j.display_name) as display_name,
        -- 承認済みかは apps で決める（ダッシュボードの SQL で付けた・外した人も正しく出る）
        case when coalesce(u.raw_app_meta_data -> 'apps', '[]'::jsonb) ? 'skyraid' then 'approved'
             when j.status = 'pending' then 'pending'
             else 'rejected' end as status,
        j.requested_at
      from auth.users u
      left join skyraid.join_requests j on j.user_id = u.id
      left join skyraid.profiles p on p.user_id = u.id
      where j.user_id is not null or coalesce(u.raw_app_meta_data -> 'apps', '[]'::jsonb) ? 'skyraid'
    ) x
    where x.status in ('pending', 'approved')
    order by x.status desc, x.requested_at nulls last, x.user_id;
end $$;
revoke all on function skyraid.list_members() from public;
revoke all on function skyraid.list_members() from anon;
grant execute on function skyraid.list_members() to authenticated;

-- ---------------------------------------------------------------- 5. セーブのバックアップの削除（本人だけ）
-- 設定の「セーブデータを削除」で「サーバーのバックアップも削除する」を選んだとき。0001 では delete を与えていなかった
grant delete on table skyraid.saves to authenticated;
drop policy if exists saves_authenticated_delete on skyraid.saves;
create policy saves_authenticated_delete on skyraid.saves for delete to authenticated
  using ((select skyraid.has_app_access()) and user_id = (select auth.uid()));

-- ---------------------------------------------------------------- 6. 適用の記録
insert into skyraid.schema_migrations (version) values ('skyraid_0002_members') on conflict do nothing;

commit;

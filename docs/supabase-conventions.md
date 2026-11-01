# Supabase 共有プロジェクトの規約 v1.0

- 対象: 1 つの Supabase プロジェクト（無料枠）に、複数の個人用アプリが相乗りする（入居する）ときの決まりごと
- 位置づけ: 入居するすべてのアプリがこの規約に従う。後続のアプリは本書を自分のリポジトリに写し、版を合わせる。規約を変えるときは版を上げ、入居中のアプリへの影響（作り直しが要るか）を変更点に書く
- 本書には特定のアプリの内容を書かない。各アプリの固有の設計（テーブル・使用量の上限など）は、そのアプリの設計書に書く。例の中の `<app>` はアプリ名（小文字の英字と数字。例: `foo`）、`<App>` は表示名を表す
- 前提: プロジェクトの管理作業（SQL の実行・設定の変更）は、プロジェクトの持ち主 1 人がダッシュボードで行う。アプリから管理者の権限は使わない

## 0. 要点

1. **アプリごとに専用のスキーマ** `<app>` を持つ。`public` には何も置かない。テーブル・ビュー・関数・型・トリガはそのスキーマの中に閉じる
2. **Storage のバケットは `<app>-` で始める**（`<app>-files` など）。他アプリのバケットに触れない。`storage.objects` のポリシーには必ず自分のバケットの条件を入れる
3. **RLS は全テーブルで有効**。匿名（anon）にはテーブルの権限を与えず、「ID を知っている者だけが読める」関数（security definer）だけを公開する
4. **Auth のユーザーは全アプリで共通**。アプリを使える人を `app_metadata.apps`（例: `["<app>"]`）で表し、RLS で必ず確認する。「新規登録を無効にしている」ことを権限の根拠にしない
5. **マイグレーションは冪等な SQL** を `supabase/migrations/<app>_NNNN_<内容>.sql` に置き、専用スキーマの作成から始める。他アプリのオブジェクトに触れない
6. **無料枠は全アプリの合算**。各アプリは自分の使用量の上限を設計書で宣言し、合計が無料枠の 80% を超えないようにする。月 1 回、使用量を確かめる（6 章の SQL）
7. 環境変数は `VITE_SUPABASE_URL`・`VITE_SUPABASE_ANON_KEY`。anon key（publishable key）は公開前提の値。**service_role key（secret key）はクライアント・リポジトリ・配信サービスの環境変数のどこにも置かない**

---

## 1. スキーマ

### 1.1 決まり

- アプリ `<app>` のオブジェクトはすべてスキーマ `<app>` に作る。`public`・`auth`・`storage`・`extensions` などの既存のスキーマにテーブル・関数を作らない（例外は 2 章の `storage.objects` のポリシーと `storage.buckets` の行だけ）
- スキーマには説明を付け、DB の中で入居者の台帳になるようにする

```sql
comment on schema <app> is '<App>: 用途の一行説明 / 管理: リポジトリの URL / 規約 v1.0';
-- 入居者の一覧: select nspname, obj_description(oid, 'pg_namespace') from pg_namespace where obj_description(oid, 'pg_namespace') like '%規約%';
```

- アプリの中だけで使い、API から呼ばせない関数（RLS の補助など）は、同じスキーマに置いたうえで `execute` を anon・authenticated に与えない。公開と非公開をスキーマで分けたい場合は `<app>_private`（API に公開しない）を使ってよい

### 1.2 API への公開（Data API の Exposed schemas）

- PostgREST（supabase-js の `.from()`・`.rpc()`）から使うには、ダッシュボードの Project Settings → Data API → **Exposed schemas** に `<app>` を足す。足すのは自分のスキーマだけ。既存の値（他アプリのスキーマ）を消さない
- `public` は Exposed schemas から外してよい（どのアプリも使わないため）。外すかどうかはプロジェクトの持ち主が決め、変更点を規約の版に記録する
- クライアントは `createClient(url, key, { db: { schema: '<app>' } })` でスキーマを指定する

### 1.3 権限の既定値

Postgres は新しい関数の `execute` を既定で全員（`public`）に与える。Supabase は `public` スキーマのテーブルに anon・authenticated への権限を既定で付けるが、新しいスキーマには付けない。これを踏まえて、スキーマを作った直後に次を流す。

```sql
grant usage on schema <app> to anon, authenticated;
-- 関数は明示して与えたものだけ呼べるようにする
alter default privileges in schema <app> revoke execute on functions from public;
-- テーブルの権限は 1 つずつ与える（anon には原則与えない。3 章）
```

- `alter default privileges` は **`in schema <app>` を付けて** 使う。付けないと他アプリのスキーマにも効く
- `service_role` は RLS を通らない。アプリから使わないので権限の調整は不要

---

## 2. Storage

- バケット名は `<app>-<用途>`（例: `<app>-files`）。バケットは `storage.buckets` に `insert ... on conflict (id) do update` で作る（4 章の冪等性）
- 既定は **非公開**（`public = false`）。公開バケットは、誰に見られてもよく、消すまで取得できてよいもの（アプリのアイコンなど）に限る
- `file_size_limit` と `allowed_mime_types` を必ず設定する（無料枠の保護）
- **`storage.objects` は全アプリで 1 つのテーブル**。ここに付けるポリシーは次を守る
  - 名前は `<app>_<バケットの用途>_<操作>`（ポリシー名はテーブルの中で一意なので、接頭辞がないと他アプリと衝突する）
  - 条件の先頭に **`bucket_id = '<app>-...'`** を必ず入れる。permissive なポリシーは OR で合わさるので、この条件のないポリシーが 1 つあると、他アプリのバケットまで開いてしまう
  - authenticated 向けのポリシーには 3.3 節のアプリの権限の確認を入れる
  - **anon 向けのポリシーは作らない**。Storage の一覧 API も select のポリシーで動くため、anon に select を許すとオブジェクトのパス（= ID）を一覧で取れてしまう。匿名に配るときは、権限のある利用者が作った署名付き URL を、3.2 節の関数で返す
- パスに利用者の uid・氏名・メールなどを入れない（署名付き URL に載って第三者に渡るため）

```sql
create policy <app>_files_select on storage.objects for select to authenticated
  using (bucket_id = '<app>-files' and <app>.has_app_access() and /* 持ち主の確認 */ true);
```

---

## 3. RLS と権限

### 3.1 決まり

- スキーマ内の **全テーブルで RLS を有効** にする（`enable` と `force` の両方）。RLS を無効にしたテーブルを作らない
- ポリシーは自分のスキーマのテーブル（と 2 章の `storage.objects` の自分のバケット）にだけ付ける
- ポリシーの名前は `<テーブル>_<ロール>_<操作>`（例: `items_authenticated_select`）
- `auth.uid()`・`auth.jwt()` はポリシーの中で `(select auth.uid())` の形で書く（行ごとに評価されず速い。Supabase の推奨）
- security definer の関数は `set search_path = ''` で固定し、中のテーブル・関数はすべてスキーマ名付きで書く
- 作り終えたら、ダッシュボードの **Advisors（Security Advisor）** で警告がないことを確かめる（RLS の無効・search_path の未固定・公開された security definer の関数を検出する）

### 3.2 雛形: 匿名には「ID を知っている者の読み取り」だけを許す

匿名が「ID を知っている行だけ」を読める RLS は書けない（`using (true)` は全行の一覧を許す）。そこで **テーブルは匿名に見せず、ID を引数に取る関数だけを公開する**。ID は 128bit の乱数（推測できない値）にする。

```sql
-- 匿名にはテーブルの権限を与えない
revoke all on table <app>.<table> from anon;

create or replace function <app>.get_<item>(p_id uuid)
returns table (status text, /* 匿名に見せてよい列だけ */ payload text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select 'ok'::text, t.payload
    from <app>.<table> t
    where t.id = p_id
      and not t.revoked
      and t.expires_at > now();
  if not found then
    return query select 'not_found'::text, null::text;
  end if;
end $$;

revoke all on function <app>.get_<item>(uuid) from public;
grant execute on function <app>.get_<item>(uuid) to anon, authenticated;
```

- 返す列は匿名に見せてよいものだけ（持ち主の uid・メール・内部の管理用の列を返さない）
- 1 回で 1 件だけ返す。一覧・前方一致・範囲の検索をする関数を anon に公開しない
- 閲覧の記録などで行を更新するときは `volatile` にする（上の例は読むだけなので `stable`）

### 3.3 Auth のユーザーとアプリの権限（app_metadata）

Auth のユーザー（`auth.users`）はプロジェクトに 1 つの母集団で、どのアプリのログイン画面からでも同じユーザーとしてログインできる。新規登録の可否（Allow new users to sign up）もプロジェクトで 1 つの設定なので、あるアプリが登録を開けば、全アプリで誰でもユーザーを作れる状態になる。そのため **アプリを使える人を app_metadata で表し、RLS で確かめる**。

| 選択肢                                                                     | 長所                                                                                       | 短所                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| a. `app_metadata.apps` を JWT から確かめる（**推奨**）                     | 利用者は app_metadata を書き換えられない（管理者だけ）。JWT に載るので問い合わせが要らない | 権限を変えても、アクセストークンの更新（既定 1 時間以内）まで古い値が残る |
| b. アプリのスキーマに利用者のテーブル（`<app>.members`）を持ち、RLS で引く | 即時に反映。アプリの中で役割を細かく持てる                                                 | テーブルの引きがポリシーごとに入る。管理の場所が増える                    |
| c. 新規登録を無効にし、ユーザーがいること自体を権限とみなす                | 何も作らない                                                                               | 他アプリが登録を開いた瞬間に破れる。**採らない**                          |

- 推奨は a。権限を即時に取り上げる必要が出たアプリだけ、b を足す（a と b の両方を確かめる）
- 形: `app_metadata.apps` は文字列の配列。アプリの中の役割が必要なら `app_metadata.roles.<app>` に置く

```jsonc
// auth.users.raw_app_meta_data
{ "provider": "email", "providers": ["email"], "apps": ["<app>"], "roles": { "<app>": "owner" } }
```

- 確かめる関数（各アプリのスキーマに置く。RLS の補助なので API には公開しない）

```sql
create or replace function <app>.has_app_access()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'apps') ? '<app>', false)
$$;
revoke all on function <app>.has_app_access() from public;
grant execute on function <app>.has_app_access() to authenticated;  -- ポリシーの評価に要る

create policy <table>_authenticated_select on <app>.<table> for select to authenticated
  using ((select <app>.has_app_access()) and owner = (select auth.uid()));
```

- 付与・取り消しはダッシュボードの SQL エディタで、**他アプリの値を消さないよう配列に足す・除く**（`raw_app_meta_data` を丸ごと置き換えない）

```sql
-- 付与（何度流しても同じ結果）
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb), '{apps}',
  (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
     from jsonb_array_elements_text(coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || '["<app>"]'::jsonb) v))
where email = '<利用者のメール>';

-- 取り消し
update auth.users
set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{apps}',
  coalesce((raw_app_meta_data -> 'apps') - '<app>', '[]'::jsonb))
where email = '<利用者のメール>';
```

- **user_metadata（`raw_user_meta_data`）は利用者自身が書き換えられる** ので、権限の判断に使わない
- 新規登録の可否・メールのテンプレート・SMTP・JWT の期限・Site URL・リダイレクト URL はプロジェクトで共通の設定。変えるときは全アプリへの影響を確かめ、規約の版の変更点に書く。リダイレクト URL は各アプリが自分の URL を **足す** だけにする

---

## 4. マイグレーション

### 4.1 ファイル

- 各アプリのリポジトリの `supabase/migrations/<app>_NNNN_<内容>.sql`（NNNN は 0001 からの連番。例: `<app>_0001_init.sql`）
- 最初のファイル（`<app>_0001_*.sql`）は **スキーマの作成から始める**（`create schema if not exists <app>;` → 1.3 節の権限 → スキーマの説明）
- 流すのはダッシュボードの SQL エディタ（Supabase CLI の `db push` はプロジェクト全体の履歴を 1 本で管理するため、相乗りでは使わない）。プロジェクトの持ち主が、ファイルの番号の順に流す

### 4.2 冪等性（何度流しても同じ結果）

| 対象                     | 書き方                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| スキーマ・テーブル・索引 | `create ... if not exists`。列の追加は `alter table ... add column if not exists`      |
| 関数・ビュー             | `create or replace`（返り値の型を変えるときは `drop function if exists` してから作る） |
| ポリシー・トリガ         | `drop policy if exists <名前> on <テーブル>;` → `create policy`                        |
| バケット                 | `insert into storage.buckets (...) values (...) on conflict (id) do update set ...`    |
| 権限                     | `grant` / `revoke` はもともと冪等                                                      |
| データの変換             | 条件付き（`where` で未変換の行だけ）にする                                             |

- ファイル全体を `begin; ... commit;` で囲む（途中で失敗したら何も変わらない）
- 適用の記録をアプリのスキーマに残す

```sql
create table if not exists <app>.schema_migrations (
  version text primary key, applied_at timestamptz not null default now()
);
alter table <app>.schema_migrations enable row level security;  -- ポリシーなし = API からは見えない
insert into <app>.schema_migrations (version) values ('<app>_0001_init') on conflict do nothing;
```

### 4.3 他アプリに触れない

- 触れてよいのは、自分のスキーマ、`storage.buckets` の自分の接頭辞の行、`storage.objects` の自分の接頭辞のポリシー、`auth.users` の app_metadata の自分のアプリの値（付与・取り消しだけ）
- `drop schema ... cascade`・`truncate`・`alter default privileges`（スキーマ指定なし）・拡張機能の削除や版の変更・`public` スキーマへの変更・`auth`・`storage` のテーブルの構造の変更をしない
- 拡張機能（`pgcrypto` など）が要るときは `create extension if not exists ... with schema extensions` だけ（すでにあれば何もしない）。削除はしない

### 4.4 アプリの退去

1. 自分のバケットのオブジェクトをすべて消し（ダッシュボードか API。SQL で `storage.objects` の行を消さない）、バケットを消す
2. `storage.objects` の `<app>_` で始まるポリシーを消す
3. `drop schema <app> cascade;`（このときだけ cascade を使ってよい）
4. Exposed schemas から `<app>` を外す
5. 全ユーザーの `app_metadata.apps` から `<app>` を除く（3.3 節の取り消しを全件に）
6. リダイレクト URL から自分の URL を除く

---

## 5. 環境変数とキー

| 変数                     | 中身                                                     | 置き場所                                                             | 公開してよいか                              |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| `VITE_SUPABASE_URL`      | プロジェクトの URL（`https://<ref>.supabase.co`）        | 配信サービス（Cloudflare Pages など）の環境変数 → ビルド時に埋め込む | 可（ブラウザに見える）                      |
| `VITE_SUPABASE_ANON_KEY` | anon key、または publishable key（`sb_publishable_...`） | 同上                                                                 | **可（公開前提）**。権限は RLS と関数で絞る |
| （定期実行用）           | 上の 2 つ                                                | GitHub Actions の secrets（`SUPABASE_URL`・`SUPABASE_ANON_KEY`）     | 可だがログに出さない                        |

- 全アプリで値は同じ（同じプロジェクト）。Vite 以外のアプリも名前はそろえる（接頭辞はそのツールの決まりに合わせる）
- **service_role key・secret key（`sb_secret_...`）はクライアントのコード・リポジトリ・配信サービスの環境変数・CI のどこにも置かない**。RLS を素通りし、全アプリのデータを読み書きできる。管理作業はダッシュボードで行う
- `.env.example` に変数名だけを書き、`.env*`（例を除く）は .gitignore に入れる
- CSP を使うアプリは `connect-src` に `VITE_SUPABASE_URL` のオリジンだけを足す（`*.supabase.co` のようなワイルドカードにしない）

---

## 6. 無料枠と使用量

### 6.1 無料枠（全アプリの合算。2026 年 10 月時点。変わることがあるので公式の料金ページで確かめる）

| 資源             | 無料枠                     | 規約の配分の上限（合計） |
| ---------------- | -------------------------- | ------------------------ |
| DB               | 500MB                      | 400MB（80%）             |
| Storage          | 1GB                        | 800MB（80%）             |
| 転送量（egress） | 5GB/月                     | 4GB/月（80%）            |
| 一時停止         | 7 日間アクセスがないと停止 | 6.4 節                   |

- 各アプリは自分の設計書に **使用量の上限（DB・Storage・転送量）** を書く。新しいアプリが入居するときは、既存のアプリの上限との合計が上の「配分の上限」を超えないことを確かめる。超えるなら、既存のアプリの上限を見直すか、有料プラン・別プロジェクトを検討する
- 上限はアプリの中でも守る（アップロードの前に自分のバケットの合計を確かめる、バケットの `file_size_limit`、テーブルの check 制約）

### 6.2 使用量の確認（月 1 回。プロジェクトの持ち主が SQL エディタで）

```sql
-- スキーマごとの DB の大きさ
select n.nspname as schema, pg_size_pretty(sum(pg_total_relation_size(c.oid))) as size
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
group by n.nspname order by sum(pg_total_relation_size(c.oid)) desc;

-- バケットごとの Storage の使用量
select bucket_id, count(*) as objects,
       pg_size_pretty(sum((metadata ->> 'size')::bigint)) as size
from storage.objects group by bucket_id order by sum((metadata ->> 'size')::bigint) desc;
```

- 転送量はダッシュボードの **Usage**（プロジェクト全体の月の合計）で見る。アプリごとには分けられないので、合計が配分の上限の 75%（3GB）を超えたら、Logs Explorer で Storage のリクエストをバケット名（パスの先頭）で絞って、どのアプリが多いかを調べる
- 各アプリは、自分のバケットの合計を返す関数（authenticated・アプリの権限のある人だけ）を置き、アプリの画面で上限との比を出してよい

### 6.3 アプリの中での上限の守り方（雛形）

```sql
create or replace function <app>.storage_bytes()
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum((metadata ->> 'size')::bigint), 0)
  from storage.objects where bucket_id like '<app>-%'
$$;
revoke all on function <app>.storage_bytes() from public;
grant execute on function <app>.storage_bytes() to authenticated;

-- アップロードのポリシーに上限を入れる（新しいオブジェクトの大きさは insert の時点で分からないので、
-- 「今の合計が上限未満」で止める。1 つの大きさは file_size_limit で抑える）
create policy <app>_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = '<app>-files' and (select <app>.has_app_access())
              and (select <app>.storage_bytes()) < <上限のバイト数>);
```

### 6.4 一時停止への対策

- 各アプリは自分のスキーマに `<app>.ping()`（`select 1` を返すだけ。anon に `execute`）を置き、自分のリポジトリの GitHub Actions から週 2 回呼ぶ。複数のアプリが呼んでも害はなく、どれかのアプリが退去・リポジトリの休止をしても、ほかのアプリの ping で停止を防げる
- GitHub はリポジトリに 60 日活動がないと定期実行を止める。止まっていないかを 6.2 節の月 1 回の確認で一緒に見る
- 停止したら、プロジェクトの持ち主がダッシュボードで再開する（全アプリが同時に止まる）

---

## 7. 入居時のチェックリスト

- [ ] スキーマ名・バケットの接頭辞が既存のアプリと重ならない（`pg_namespace` の説明と `storage.buckets` を確かめる）
- [ ] `<app>_0001_*.sql` がスキーマの作成から始まり、4.2 節の書き方で冪等。2 回流してエラーにならない
- [ ] 全テーブルで RLS が有効。anon にテーブルの権限がない。anon に公開する関数は 3.2 節の形
- [ ] `storage.objects` のポリシーの名前が `<app>_` で始まり、すべて自分のバケットの条件を含む
- [ ] authenticated のポリシーがすべて `has_app_access()` を確かめている
- [ ] Exposed schemas に自分のスキーマを足した（他を消していない）
- [ ] Advisors（Security）に警告がない
- [ ] 設計書に使用量の上限を書き、合計が 6.1 節の配分の上限に収まる
- [ ] service_role key がどこにもない（リポジトリを `service_role`・`sb_secret_` で検索する）
- [ ] `<app>.ping()` と定期実行を置いた

## 変更履歴

- v1.0: 初版

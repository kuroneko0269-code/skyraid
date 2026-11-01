# SkyRaid の Supabase 設計書（7-4）

- 対象: 共有の Supabase プロジェクト（無料枠）に入居する SkyRaid: Titan Skies のクラウドセーブとメンバー内ランキング
- 従う規約: `docs/supabase-conventions.md`（Supabase 共有プロジェクトの規約 **v1.0**）
- マイグレーション: `supabase/migrations/skyraid_0001_init.sql`
- クライアント: `src/online/`（Three.js・DOM 非依存のロジック）と `src/ui/online-*.ts`・`ranking-screen.ts`・`sync-dialog.ts`（画面）。数値は `src/data/online.ts`

## 1. 方針

| 項目 | 決めたこと |
| --- | --- |
| アプリ名・スキーマ | `skyraid`。オブジェクトはすべてスキーマ `skyraid` の中。`public`・`auth`・`storage` には何も作らない |
| Storage | 使わない（バケットなし） |
| Auth | メール OTP（6 桁のコード）。プロジェクト共通の Auth の設定は変えない前提（5 章の注意） |
| アプリの権限 | `app_metadata.apps` に `'skyraid'` があるユーザーだけ（規約 3.3 の a）。確かめる関数は `skyraid.has_app_access()`。authenticated のポリシーはすべてこれを確かめる |
| anon | テーブル・ビュー・関数の権限なし。anon に公開する関数も作らない（匿名向けの機能はない） |
| セーブ | ローカル（localStorage の `skyraid.save`）が正、サーバーはバックアップ。オンライン連携はオプトインで、連携しなくても全機能が今までどおり動く |
| 環境変数 | `VITE_SUPABASE_URL`・`VITE_SUPABASE_ANON_KEY`（Cloudflare Pages の環境変数）。無ければオフライン（連携の部分を読み込まず、UI も出さない）。**service_role key は使わない**（クライアントは誤って入れられた secret key・service_role の JWT を拒否してオフラインになる） |
| CSP | ビルド時に `dist/_headers` の `connect-src` へ `VITE_SUPABASE_URL` のオリジンだけを足す（`vite.config.ts` の `supabaseCsp`。ワイルドカードにしない） |

## 2. テーブル

すべて RLS を `enable` と `force` の両方で有効にしている。delete の権限はどのテーブルにも与えない。

### `skyraid.profiles`（表示名）

| 列 | 型 | 説明 |
| --- | --- | --- |
| `user_id` | uuid PK | 既定値 `auth.uid()`。auth.users への外部キーは張らない（auth のテーブルに触れないため） |
| `display_name` | text | 1〜16 文字（`char_length`）。制御文字・前後の空白は不可。初めて連携したときにパイロット名で作り、設定で変えられる |
| `created_at` / `updated_at` | timestamptz | `updated_at` はトリガでサーバーの時刻にする |

- select: メンバー全員（`has_app_access()`）。**ランキングに表示名を出すため**（ビューは security invoker なので、本人だけにすると他人の名前が読めない。7-4 の質問で決定）
- insert / update: 本人だけ。メールアドレスは保存しない

### `skyraid.saves`（セーブのバックアップ。1 ユーザー 1 行）

| 列 | 型 | 説明 |
| --- | --- | --- |
| `user_id` | uuid PK | 既定値 `auth.uid()` |
| `version` | int | セーブの版（今は 8）。1〜1000 |
| `data` | jsonb | セーブの JSON（オブジェクト）。**`octet_length(data::text) <= 262144`（256KB）の check** |
| `size_bytes` | int | トリガで `octet_length(data::text)` を入れる（使用量の確認用） |
| `updated_at` | timestamptz | トリガでサーバーの時刻。同期の競合判定に使う |

- select / insert / update: 本人だけ（delete 不可）。update で `user_id` は変えられない（トリガで元の値に戻す）
- クライアントの update は「`updated_at` が前回の同期のときのまま」の行だけを書く（他の端末が先に書いていたら 0 行 = 競合）

### `skyraid.records`（記録）

| 列 | 型 | 説明 |
| --- | --- | --- |
| `id` | bigint identity PK | |
| `user_id` | uuid | 既定値 `auth.uid()`（ポリシーで本人に限る） |
| `kind` | text | `race` / `raid` / `defense` |
| `key` | text | レース: コース id（`coast` `canyon` `harbor-speed` `acro`）/ レイド: 難易度（`normal` `hard`）/ 防衛戦: `マップ:難易度`（`island:normal` など 4 つ）。check で列挙 |
| `aircraft_id` | text | `^[a-z0-9-]{1,32}$` |
| `value_ms` | int | 1〜3,600,000。レース: タイム（ペナルティ・ボーナス込み）/ レイド: 撃破までの時間 / 防衛戦: 終わるまでの時間 |
| `detail` | jsonb | 1KB 以下のオブジェクト。レース `{missed, thin}` / レイド `{rank}` / 防衛戦 `{waves, hq, kills, cleared}` |
| `client_version` | text | 1〜32 文字（今は `skyraid-web/1`） |
| `created_at` | timestamptz | トリガでサーバーの時刻（クライアントの値は使わない） |

- select: メンバー全員。insert: 本人。update / delete: 不可
- 不正値の check:
  - **レース**: コースの理論最短 × 0.5 未満を拒否。理論最短 = スタート → 各リングの中心の折れ線の長さ ÷ 最速の機体（全機体の強化 Lv 最大）の速度の絶対上限 634.8 m/s − 細いリングのボーナス全部（下限 1 秒）。下限は 海岸周回 13.927 秒（ゴールド 48 秒）・渓谷スラローム 7.848 秒（29 秒）・港湾ハイスピード 5.936 秒（25 秒）・夕空アクロバット 7.187 秒（27 秒）。値は `src/online/records.ts` の `raceFloorMs` と同じ（`tests/online-sql.test.ts` で突き合わせる）。コースを変えたら SQL の値も変える（新しいマイグレーション）
  - **防衛戦**: `detail.waves` が 0〜10 の整数でなければ拒否（11 波以上を拒否）。`detail.hq` は 0〜100
  - クライアントも送る前に同じ規則で確かめ（`checkRecord`）、通らない記録は送らない
- 送るのは: レースの完走（時間切れは送らない）・ソロのレイドのクリア・ソロの防衛戦の終わり（成功・陥落とも）。リプレイの再生・ゴーストからは送らない。協力（P2P）は人数で難しさが変わるので送らない（7-4 の質問で決定）

### トリガ

| トリガ | 内容 |
| --- | --- |
| `profiles_touch` / `saves_touch` | `updated_at` をサーバーの時刻に、セーブの `size_bytes` を計算、update で `user_id` を変えさせない |
| `records_before_insert` | **レート制限: 1 ユーザー 1 分 20 行**（超えたら `P0001`・hint `rate_limit`）。`created_at` をサーバーの時刻に |
| `records_after_insert` | **間引き: kind × key × ユーザー（レースは機体も）ごとに最良 3 件だけ残す**。直近 1 分の行はレート制限で数えるため残し、次の送信で消す |

- 間引きをレースだけ機体で分けたのは、ランキングがコース × 機体のため（機体ごとの最速が消えないように）。1 ユーザーの行は最大 66 行（レース 4 コース × 4 機体 × 3 + レイド 2 × 3 + 防衛戦 4 × 3）+ 直近 1 分の 20 行
- 「最良」の並び: レース・レイドは `value_ms` の短い順。防衛戦は波の多い順 → 司令部の残りの多い順 → `value_ms` の短い順（関数 `skyraid.record_sort_key`）
- 2 つの記録のトリガは security definer（所有者 postgres の権限）で動く。**`force row level security` は所有者にも効く**（postgres に BYPASSRLS が無い場合）ので、records と schema_migrations に `to postgres` のポリシー（`records_postgres_select` / `records_postgres_delete` / `schema_migrations_postgres_select` / `schema_migrations_postgres_insert`）を置いた。postgres は API から使われないロール（API は anon / authenticated で動く）なので、利用者の権限は広がらない。BYPASSRLS がある環境では使われないだけで害はない

### ビュー（ランキング。すべて `security_invoker = true` = 見る人の RLS を通す）

| ビュー | 内容 |
| --- | --- |
| `skyraid.race_best` | kind = race。コース × 機体ごとに、ユーザーごとの最速 1 本、上位 100（`place` は同タイム同順位） |
| `skyraid.raid_best` | 難易度ごとに、ユーザーごとの最速 1 本、上位 100 |
| `skyraid.defense_best` | マップ × 難易度ごとに、ユーザーごとの最良 1 本、上位 100 |

列: `key, aircraft_id, user_id, display_name, value_ms, detail, created_at, place`。select は authenticated だけ。

### 関数

| 関数 | 実行できるロール | 説明 |
| --- | --- | --- |
| `skyraid.has_app_access()` | authenticated（ポリシーの評価用） | 規約 3.3 のまま。`(auth.jwt() -> 'app_metadata' -> 'apps') ? 'skyraid'` |
| `skyraid.record_sort_key(text, jsonb)` | authenticated（ビューの評価用） | 記録の並びのキー（immutable） |
| `skyraid.touch_updated_at()` / `records_before_insert()` / `records_after_insert()` | なし（トリガ専用） | |

- すべて `set search_path = ''`、中はスキーマ名付き。すべて `revoke all ... from public`（Postgres の仕様で、`alter default privileges in schema skyraid revoke execute on functions from public` は全体の既定値の「public に execute」を取り消せないため、個別にも revoke している）

## 3. 使用量の上限（規約 6 章）

| 資源 | SkyRaid の上限 | 守り方・見積もり |
| --- | --- | --- |
| DB | **20MB** | セーブは 1 人 256KB まで（check）、記録は 1 人 最大 86 行（間引き + レート制限）。セーブは今の形でレースのゴースト 4 本込み約 60KB。記録 1 行は索引込み約 0.4KB → 1 人あたり 最悪 約 0.3MB・ふつう約 0.1MB。**メンバー 60 人まで**は最悪でも 20MB に収まる |
| 転送量（egress） | **月 100MB** | 起動・ログインのたびに読むのはセーブの版と更新日時だけ（約 100 バイト）。本体（約 60KB）は他の端末の変更を受け取るときだけ。送信の応答は版と更新日時だけ。ランキングは 1 回 最大 100 行（約 20KB）で 5 分キャッシュ。目安: 20 人 × 月 30 回の起動 × 他端末からの受け取り 1/3 で約 12MB + ランキング 20 人 × 月 40 回 × 20KB で約 16MB = 約 30MB |
| Storage | **0** | 使わない |

- 規約 6.1 の配分の上限（DB 400MB・Storage 800MB・転送量 4GB/月）に対し、既存の入居アプリの上限と合計して超えないことを、入居時にプロジェクトの持ち主が確かめる（7 章のチェックリスト）
- 月 1 回の確認（規約 6.2 の SQL）で `skyraid` のスキーマの大きさを見る。SkyRaid だけの内訳は次の SQL

```sql
select count(*) as users, pg_size_pretty(sum(size_bytes)::bigint) as saves, max(size_bytes) as max_save
from skyraid.saves;
select kind, count(*) as rows, count(distinct user_id) as users from skyraid.records group by kind;
select pg_size_pretty(pg_total_relation_size('skyraid.records')) as records_size;
```

## 4. 退去手順（規約 4.4）

SkyRaid は Storage を使わないので、1・2 は該当なし。

1. （バケットなし）
2. （`storage.objects` のポリシーなし）
3. SQL エディタで `drop schema skyraid cascade;`（このときだけ cascade を使ってよい）
4. Project Settings → Data API → Exposed schemas から `skyraid` を外す（他の値は消さない）
5. 全ユーザーの `app_metadata.apps` から `skyraid` を除く:

```sql
update auth.users
set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{apps}',
  coalesce((raw_app_meta_data -> 'apps') - 'skyraid', '[]'::jsonb))
where raw_app_meta_data -> 'apps' ? 'skyraid';
```

6. リダイレクト URL に SkyRaid の URL を足していたら除く
7. Cloudflare Pages の環境変数 `VITE_SUPABASE_URL`・`VITE_SUPABASE_ANON_KEY` を消して再ビルドする（オフラインに戻り、全機能はローカルで動く）

利用者を 1 人だけ消すとき（Auth からユーザーを消しても、外部キーが無いので行は残る）:

```sql
delete from skyraid.records where user_id = '<uuid>';
delete from skyraid.saves where user_id = '<uuid>';
delete from skyraid.profiles where user_id = '<uuid>';
```

## 5. 注意（プロジェクト共通の設定との関係）

- **6 桁のコードはメールのテンプレートに `{{ .Token }}` が要る**。Supabase の `signInWithOtp` はマジックリンクと同じ仕組みで、既定のテンプレート（Magic Link・Confirm signup）はリンクだけを送る。テンプレートはプロジェクト共通の設定（規約 3.3 の最後）なので、SkyRaid からは変えない前提にした。そのため:
  - テンプレートに `{{ .Token }}` があれば、メールのコードを入れてログインする（本来の形）
  - リンクしか無ければ、リンクを開いてもログインできる（`emailRedirectTo` を SkyRaid の URL にし、`detectSessionInUrl` で受け取る）。このためには **Auth → URL Configuration の Redirect URLs に SkyRaid の URL を足す**（規約 3.3: 各アプリが自分の URL を足すだけ）
  - テンプレートに `{{ .Token }}` を足す（リンクと併記）ときは、全アプリのメールが変わるので、規約の版の変更点に書いてから
- 新規登録（Allow new users to sign up）が無効なら、新しい人はコードを受け取れない（既存のユーザーはログインできる）。SkyRaid は「登録を無効にしている」ことを権限の根拠にしていない（権限は app_metadata）
- 権限を付けた・外した後、反映はアクセストークンの更新まで（既定 1 時間以内）。承認待ちの画面の「承認を再確認」でトークンを取り直すとすぐ反映する

## 6. 規約に合わせなかった点

| 規約 | 内容 | 理由 |
| --- | --- | --- |
| 6.4 | `skyraid.ping()`（anon に execute）と GitHub Actions の定期実行を置いていない | 7-4 の指示（anon に公開する関数を作らない）と CLAUDE.md（GitHub Actions を使わない）に従った（7-4 の質問で決定）。一時停止は他の入居アプリの ping か、持ち主の手動の再開に任せる |
| 4.2 の雛形 | schema_migrations も `force` にし、postgres 用のポリシーを足した | 7-4 の指示（全テーブルで enable と force）。force でも所有者が適用の記録を書けるように |

## 7. 入居時のチェックリスト（規約 7 章）

| 項目 | 結果 |
| --- | --- |
| スキーマ名・バケットの接頭辞が既存のアプリと重ならない | **人間が確認**（`select nspname, obj_description(oid, 'pg_namespace') from pg_namespace where obj_description(oid, 'pg_namespace') like '%規約%';` と `storage.buckets`）。バケットは使わない |
| `skyraid_0001_*.sql` がスキーマの作成から始まり、4.2 節の書き方で冪等。2 回流してエラーにならない | 済（ローカルの Postgres 16 で Supabase のロールを模して 2 回流し、RLS・check・レート制限・間引きの挙動も確認）。**本番で 2 回流す確認は人間** |
| 全テーブルで RLS が有効。anon にテーブルの権限がない。anon に公開する関数は 3.2 節の形 | 済（enable と force。anon は usage だけ。anon に公開する関数はなし） |
| `storage.objects` のポリシーの名前が `<app>_` で始まり、自分のバケットの条件を含む | 該当なし（Storage を使わない） |
| authenticated のポリシーがすべて `has_app_access()` を確かめている | 済（`tests/online-sql.test.ts` で確認） |
| Exposed schemas に自分のスキーマを足した（他を消していない） | **人間が実施** |
| Advisors（Security）に警告がない | **人間が確認** |
| 設計書に使用量の上限を書き、合計が 6.1 節の配分の上限に収まる | 上限は 3 章（DB 20MB・転送量 月 100MB・Storage 0）。**合計の確認は人間**（既存アプリの上限が分からないため） |
| service_role key がどこにもない（`service_role`・`sb_secret_` で検索） | 済。検索に当たるのは、誤って入れられた secret key を拒否するコード（`src/online/env.ts`）・テスト・文書の説明だけで、key の値はない |
| `<app>.ping()` と定期実行を置いた | **未実施**（6 章の理由） |

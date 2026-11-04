# SkyRaid: Titan Skies

> **English:** SkyRaid: Titan Skies is a 3D arcade flight shooter that runs in your browser — no install needed.
> Fly the campaign and ring races, battle friends in 2–4 player PvP, or team up
> (1–4 players) to defend your base and take down the giant monster Vorgas. Works on PCs and phones (touch, keyboard and
> gamepad). The game is available in English and Japanese: it follows your browser's language on first launch, and you
> can switch in Settings → Display → Language. Requires a browser with WebGL 2 (iOS 16.4+, Chrome/Edge 105+,
> Safari 16.4+, Firefox 121+). Online Link (cloud save and rankings) is optional and limited to approved members.

ブラウザで動く 3D フライトシューティング（v1.0.1）。インストール不要で、パソコンとスマホで遊べます。ホーム画面に追加するとアプリのように全画面で起動し、PvP・協力以外はオフラインでも遊べます。

## 遊び方

タイトル →「モード選択」の「遊ぶ」から選びます。初めてのときはチュートリアル（5 段階・撃墜されない練習）を勧めます。

| モード | 人数 | 内容 |
| --- | --- | --- |
| チュートリアル | ソロ | 旋回・加速・機銃・ミサイル・フレアの練習 |
| キャンペーン | ソロ | 5 ミッション（訓練 → 怪獣の出現）。報酬のクレジットで機体の購入・強化・塗装 |
| フリーフライト | ソロ | マップ・天候・時間帯を選んで自由に飛ぶ（敵機の有無・難易度も選べる） |
| リングレース | ソロ | 4 コース。ゴーストと競ってタイムとランク |
| PvP | 2〜4 人 | 部屋コード・共有 / QR で集まって個人戦・チーム戦（2 対 2） |
| レイド | 1〜4 人 | 港湾都市に上陸する怪獣ヴォルガスを部位を壊して倒す（通常 / 高難度） |
| 防衛戦 | 1〜4 人 | 基地を全 10 波の攻撃から守る |

「管理」からハンガー（機体・強化・塗装）・リプレイ（記録の再生・書き出し）・設定・情報（版・更新履歴・ライセンス・データの扱い）を開けます。結果画面の「記録カード」で結果を画像にして共有できます。

### 操作（主なもの）

| 動作 | キーボード | ゲームパッド | タッチ |
| --- | --- | --- | --- |
| 機首の上げ下げ・傾け | WASD / 矢印 | 左スティック | 左下のスティック |
| ヨー | Q / E | LT / RT | 左上・右上の ◀ ▶ |
| スロットル | Shift / Z | 右スティック上下 | 右端のスライダー |
| 機銃 / ミサイル | Space / F | RB / A | GUN / MSL |
| アフターバーナー / フレア | R / X | LB / B | AB / FLR |
| ターゲット切替 | Tab | Y | HUD の対象をタップ |
| ポーズ | Esc | Start | 右上の ⏸ |

キーの割り当て・感度・操作補助（エイムアシストなど）は設定で変えられます。全部の操作は `docs/spec.md` の「操作」。

## 動作環境

| 端末 | 最低の版 |
| --- | --- |
| iPhone / iPad | iOS / iPadOS 16.4 以降の Safari（ホーム画面に追加したアプリも同じ） |
| Android | Chrome 105 以降 |
| パソコン | Chrome / Edge 105 以降・Safari 16.4 以降・Firefox 121 以降 |

- WebGL 2 が必要（ブラウザのハードウェア アクセラレーションを ON）。推奨はノートパソコンの内蔵 GPU 以上・2020 年以降のスマホ。スマホは横画面で遊びます
- 下限はビルドの出力（three の class の static ブロック = ES2022）と WebGL 2 で決まる。決め方と各機能の確認結果は `docs/compat.md`
- WebGL が使えない・古いブラウザでは真っ黒にせず案内画面を出す。文面と表は `src/data/i18n/ja.json` / `en.json` の `compat`（`src/legacy/legacy-check.js` にはビルド時に埋め込む）

## セーブとオンライン連携

- 進み具合・設定はブラウザの中（localStorage、リプレイは IndexedDB）に保存します。アカウントは要りません。別の端末へは設定 → データの「セーブデータをコピー」→「貼り付けて復元」で移せます
- **オンライン連携（クラウドセーブ・メンバー内のランキング）は、持ち主が承認したメンバーだけの任意の機能**です。使わなくても全モードを遊べます。メールのコードでログインし、承認されると「連携中」になります（サーバーに送るのはセーブのバックアップと記録、個人の情報はメールアドレスとパイロット名だけ。詳しくは情報画面の「データの扱い」）
- 公開のビルドに Supabase の環境変数が無ければ、連携の UI は出ず通信もしません（準備の手順は下の「オンライン連携の準備」）
- PvP・協力は端末どうしを直接つなぐ P2P（PeerJS）なので、相手に IP アドレスが見えます

## 開発

```
npm ci          # 依存のインストール
npm run dev     # 開発サーバー（http://localhost:5173/）
npm run check   # 型と lint
npm test        # テスト（Vitest）
npm run build   # 本番ビルド（dist/）
```

- 技術: TypeScript・Vite・Three.js。物理は自前の簡易アーケード物理、P2P は PeerJS、オンライン連携は Supabase（任意）
- 仕様は `docs/spec.md`、計画は `docs/plan.md`、決定の記録は `docs/decisions.md`、更新履歴は `docs/changelog.md`（アプリの「情報 → 更新履歴」に出る）。作業の決まりは `CLAUDE.md`
- 公開: main に push すると Cloudflare Pages が `npm run build` して `dist/` を配信します（ビルドに GitHub Actions は使いません。main の package.json の版が上がると、GitHub Actions がタグ vX.Y.Z と更新履歴を本文にしたリリースを作ります。更新の無い claude/* のブランチは毎日掃除します）。公開前の点検は `docs/release-checklist.md`（`node scripts/ui-audit.js <出力先> --release` など）、性能の計測は `docs/perf.md`（`npm run perf`）
- 版は `package.json` の version（タイトルの右下・情報画面に出る）。公開した版には git のタグ（`v1.0.1` など）が付きます（GitHub Actions の release。v1.0.1 から）

---

以下は持ち主・開発者向けの運用の手順です。

## ブランド素材の差し替え

`public/brand/` のファイルを同じ名前で置き換えると、ビルド後にそのまま使われます。

| ファイル | 用途 | 推奨 |
| --- | --- | --- |
| `public/brand/logo.png` | タイトル画面のロゴ。**置けば画像、無ければテキストのロゴ** | 横長・背景透過の PNG。透明な余白はトリム、幅 2000px・500KB 以下。表示は画面の幅の 46%（最大 760px）・高さの 24% に収める |
| `public/brand/icon-512.png` | PWA のアイコン（ホーム画面・スプラッシュ） | 512×512。角丸・外は透明 |
| `public/brand/icon-192.png` | PWA のアイコン・ブラウザのタブ（PNG に対応したもの） | 192×192。角丸・外は透明 |
| `public/brand/icon-maskable-512.png` | PWA の maskable アイコン（Android が形を切り抜く） | 512×512。全面を塗り、絵は中央 80% の円に収める |
| `public/brand/apple-touch-icon.png` | iOS のホーム画面 | 180×180。全面を塗る（iOS が角を丸める） |
| `public/brand/favicon.ico` | ブラウザのタブのアイコン | 16・32・48px を含む ICO |
| `public/brand/og-image.jpg` | リンクのプレビュー（OGP。8-5）。英語の固定の画像 | 1200×630 の JPEG。ロゴを差し替えたら `node scripts/og-image.js` で作り直す（記録カードと同じ描画） |

アイコンを差し替えるときは、元画像 `assets-src/brand/icon-source.png`（正方形・1024px 以上・角丸の外は白。配信物には入らない）を置き換えて `python3 -I scripts/brand-icons.py public/brand`（Pillow が必要）を実行すると、上の 5 つのアイコンを作り直し、ロゴの余白もトリムします。

アプリ名・テーマ色は `src/data/app.ts`、セキュリティヘッダーは `public/_headers`（Cloudflare Pages の形式）。

OGP の `og:image` は、Cloudflare Pages ではビルドに渡される `CF_PAGES_URL` で絶対 URL になります。独自ドメインで公開するときは環境変数 `VITE_SITE_URL`（例 `https://skyraid.example.com`）を入れると、その URL を使います（無ければ `/brand/og-image.jpg`）。

## BGM の差し替え

効果音はすべてコードで合成しているので音声ファイルはいりません。BGM だけは次の場所に MP3 を置くと流れます（無ければ無音）。

| ファイル | 流れる画面 |
| --- | --- |
| `public/audio/bgm/title.mp3` | タイトル・モード選択・ミッション一覧・ブリーフィング・ハンガー |
| `public/audio/bgm/flight.mp3` | 飛行中・ポーズ中 |
| `public/audio/bgm/result.mp3` | リザルト |

- ループ再生し、画面が変わると 1 秒でクロスフェードします。ループの継ぎ目が目立たないよう、曲の頭と終わりをつなげて作ってください
- 1 ファイル 25MB 以下（Cloudflare Pages の制限）。数 MB に収まる 128〜192kbps 程度を推奨。オフライン用のキャッシュ（Service Worker）には入りません
- **ビルド時に存在するファイルだけを読みます。追加・削除した後は再ビルドが必要です**（main への push で Cloudflare Pages が自動でビルドします）。置き換えたら `npm run build` して公開するだけです（コードの変更はいりません）。音量は設定画面の「音」（またはポーズメニュー）の BGM のスライダー
- ライセンスが明確な素材（CC0 / CC-BY）だけを使い、出典を `docs/assets.md` に書いてください

### 音が鳴らないとき

- ブラウザの制限で、最初に画面をタップ（クリック・キー入力）するまで音は出ません
- **iPhone / iPad はサイレントスイッチ（消音モード）がオンだと鳴りません**（Safari の Web Audio の仕様です）。スイッチをオフにするか、音量ボタンで音量を上げてください
- タブを裏に回すと止まり、戻ると再開します


## PvP（P2P 通信）の確認手順（5-1）

PvP は PeerJS の公開シグナリングサーバー（`0.peerjs.com`）で相手を見つけ、WebRTC で端末どうしを直接つなぎます（サーバー費なし）。2 台で次のように確かめてください。

### 2 台での確認

1. 両方の端末で Cloudflare のプレビュー URL を開く（URL の末尾に `?netdebug` を付けると通信の値が出ます）
2. **端末 A（ホスト）**: タイトル →「モード選択」→「PvP」→「部屋を作る」。6 文字の部屋コード（例 `4X9MXK`）が出る
3. **端末 B（参加）**: 「PvP」→ 部屋コードを入れて「コードで参加」。または `プレビューURL?room=4X9MXK` を開くと直接参加する（`&netdebug` も付けられます）
4. 両方のロビーに 2 人（ホストは赤、2 人目は青）が並ぶことを確かめる
5. A が「開始」→ 両方とも島の沖合に横一列で出現する。相手の機体が自分の色ではない色で見え、名前と距離の名札が付くことを確かめる
6. しばらく飛ばして、相手の機体がなめらかに動くか（カクつき・瞬間移動がないか）、自分の機体の操作に遅れがないかを見る
7. 切断の確認:
   - B の Esc（またはタッチの ⏸）→「退出する」→ A の画面から B の機体と名札が消える
   - もう一度部屋を作り直して開始し、A の Esc →「退出する」→ B に「ホストが切断しました」と出てモード選択へ戻る
   - A のタブを閉じる（または機内モードにする）→ 6 秒ほどで B に「ホストが切断しました」
8. 3〜4 台あれば、3 人目（黄）・4 人目（緑）も同じように参加できること、5 人目は「満員です」と断られることを確かめる

`?netdebug` の表示（左下）:

| 表示 | 意味 | 目安 |
| --- | --- | --- |
| `RTT` | 往復の時間 | 同じ Wi-Fi で数十 ms、モバイル回線で 100〜300ms |
| `state` | 状態の受信（ホストは送信）の回数 / 秒 | 15 前後 |
| `補間遅延` / `余裕` | 他機を何 ms 遅らせて描いているか / 最新の状態に対する余裕 | 100ms / 余裕がプラスならなめらか、マイナスが続くと外挿（予測）中 |
| `外挿` | 状態が途切れて予測で描いている他機の数 | ふだん 0 |
| `自機の補正` | ホストとずれて自分の機体を直した回数 | ふだんはほとんど増えない |
| `入力の溜め` / `推測` / `溜め直し`（ホスト） | 参加者の入力の溜まり具合 / 届かず直前の操作で埋めた数 / 溜め直した回数 | 溜め 2〜8、推測・溜め直しはたまに増える程度 |

### 1 台での確認（シグナリングサーバーを使わない）

URL に `?net=local` を付けると、PeerJS の代わりに**同じブラウザのタブどうし**で通信します（例: タブ 1 で `?net=local` を開いて部屋を作り、タブ 2 で `?net=local&room=コード`）。画面の流れの確認用で、2 台での確認の代わりにはなりません。

### つながらないとき

- 「その部屋は見つかりません」: 部屋コードの打ち間違い、またはホストがロビーを出た。0・O・1・I は使っていません
- 「接続できませんでした」「応答がありません」: 片方のネットワークが WebRTC の直接接続を通さない可能性があります（会社・学校の Wi-Fi、一部のモバイル回線）。両方を同じ Wi-Fi にして試してください。中継サーバー（TURN）は今は使っていません
- 「ホストとバージョンが違います」: 片方が古い版をキャッシュしています。両方とも再読み込み（PWA ならアプリを一度閉じて開き直す）

## オンライン連携（クラウドセーブとランキング）の準備（7-4）

バックエンドは共有の Supabase プロジェクト（`docs/supabase-conventions.md` の規約 v1.0）。設計は `docs/supabase-design.md`、SQL は `supabase/migrations/skyraid_0001_init.sql`。
環境変数が無ければオフラインのまま（連携の UI は出ず、全モードが今までどおり動く）なので、準備は急がなくて構いません。

**service_role key（secret key、`sb_secret_...`）は使いません。** コード・リポジトリ・Cloudflare の環境変数・CI のどこにも置かないでください（RLS を素通りして全アプリのデータを読み書きできてしまいます）。使うのは公開前提の anon key（publishable key）だけです。管理作業はすべてダッシュボードで行います。

1. **Exposed schemas に `skyraid` を足す**: Project Settings → Data API → Exposed schemas に `skyraid` を追加（既存の値は消さない）
2. **SQL を流す**: SQL エディタに `supabase/migrations/skyraid_0001_init.sql` の全文を貼り付けて実行。**もう一度そのまま実行してもエラーにならない**ことも確かめる（冪等）。`select * from skyraid.schema_migrations;` に `skyraid_0001_init` が 1 行
3. **Cloudflare Pages の環境変数**: Settings → Variables and Secrets（Production と Preview の両方）に次の 2 つを入れて再デプロイ。ビルドで `_headers` の CSP の `connect-src` にこの URL のオリジンが足されます（`dist/_headers` で確認できます）

   | 変数 | 値 |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co`（Project Settings → Data API の URL） |
   | `VITE_SUPABASE_ANON_KEY` | anon key または publishable key（`sb_publishable_...`） |

   ローカルで試すときは `.env.example` を `.env` に写して値を入れる（`.env` はコミットされません）
4. **Advisors で警告 0 を確かめる**: Advisors → Security Advisor で SkyRaid（スキーマ `skyraid`）の警告が無いこと
5. **自分のメールで登録**: プレビュー URL → タイトル右上の歯車（またはモード選択の「設定」）→「データ」タブ →「オンライン連携」でメールアドレスを入れて「コードを送る」→ メールのコード（4〜10 桁）を入れて「ログイン」。状態が「承認待ち」になる
   - このプロジェクトは **Authentication → Sign In / Providers → Allow new users to sign up を ON** にしてある（8-1 の時点）。そのため、初めての人も「コードを送る」だけでユーザーが作られて登録でき、ログインした時点で承認待ちの一覧に載る（持ち主がダッシュボードでユーザーを作る必要はない）
   - **メールのテンプレートは 2 つとも `{{ .Token }}` が要る**: 初めての人（ユーザーがまだ無い）には **Confirm sign up**、2 回目からの人には **Magic Link** のテンプレートのメールが届く。どちらかに `{{ .Token }}` が無いと、その人のメールにコードが出ない（Authentication → Emails → Templates）。テンプレートは全アプリ共通の設定なので、変えるときは規約の版の変更点に書いてから（`docs/supabase-design.md` の 5 章）
   - メールにコードが無くリンクしか無いときは、ブラウザならリンクを開いてもログインできます（そのためには Auth → URL Configuration → Redirect URLs に SkyRaid の URL を**足す**。既存の URL は消さない）。ホーム画面のアプリ（PWA）ではリンクが Safari で開いて別の保存領域になるので、コードが要る
6. **SQL で app_metadata に skyraid を付与**（規約 3.3 の SQL。他アプリの値は消さない。何度流しても同じ結果。7-4b の後は、持ち主自身を owner にする 1 回だけで、ほかの人の承認はゲームの中で行う。下の「メンバー承認をゲームの中で行う」）:

   ```sql
   -- 付与（何度流しても同じ結果）
   update auth.users
   set raw_app_meta_data = jsonb_set(
     coalesce(raw_app_meta_data, '{}'::jsonb), '{apps}',
     (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || '["skyraid"]'::jsonb) v))
   where email = '<利用者のメール>';

   -- 取り消し
   update auth.users
   set raw_app_meta_data = jsonb_set(raw_app_meta_data, '{apps}',
     coalesce((raw_app_meta_data -> 'apps') - 'skyraid', '[]'::jsonb))
   where email = '<利用者のメール>';
   ```

7. **承認待ちが連携中に変わることを確かめる**: 設定の「承認を再確認」を押す（7-4b からは承認待ちの間 5 分ごとに自動で確かめる）→ 状態が「連携中」になり、表示名の欄にパイロット名が入る。モード選択に「ランキング」が出る

### メンバー承認をゲームの中で行う（7-4b。最初に 1 回だけ）

`supabase/migrations/skyraid_0002_members.sql` を入れると、承認待ちの人はログインした時点で「承認待ち一覧」に載り、持ち主（owner）がゲームの設定「メンバー管理」の「承認」ボタンで承認できます（相手の画面は 5 分以内に自動で「連携中」に変わります）。規約からの逸脱（関数が `auth.users` の `apps` の `skyraid` だけを書き換える）は `docs/supabase-design.md` の 8 章。

1. **SQL を流す**: SQL エディタに `supabase/migrations/skyraid_0002_members.sql` の全文を貼り付けて実行。もう一度実行してもエラーにならないことも確かめる。`select * from skyraid.schema_migrations;` に `skyraid_0002_members` が増える（0001 を流し直したときは 0002 も続けて流し直す）
2. **自分を owner にする**（初回だけ。規約 3.3 の形で `apps` と `roles` の両方を付ける。他アプリの値は消さない。何度流しても同じ結果。`roles` の階層がまだ無いユーザーでも付く: 7-4d）:

   ```sql
   -- (1) apps に skyraid を足す（上の 6 の付与と同じ）
   update auth.users
   set raw_app_meta_data = jsonb_set(
     coalesce(raw_app_meta_data, '{}'::jsonb), '{apps}',
     (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(raw_app_meta_data -> 'apps', '[]'::jsonb) || '["skyraid"]'::jsonb) v))
   where email = '<持ち主のメール>';

   -- (2) roles.skyraid = owner（roles が無ければ作る。他アプリの roles は残る）
   update auth.users
   set raw_app_meta_data = jsonb_set(
     coalesce(raw_app_meta_data, '{}'::jsonb), '{roles}',
     coalesce(raw_app_meta_data -> 'roles', '{}'::jsonb) || '{"skyraid": "owner"}'::jsonb, true)
   where email = '<持ち主のメール>';

   -- 確認: apps に "skyraid"、roles に "skyraid": "owner" がある（他アプリの値も残っている）
   select email, raw_app_meta_data from auth.users where email = '<持ち主のメール>';
   ```

   まだ SkyRaid でログインしたことが無ければ、先に上の 5 の手順でログインしてユーザーを作ってから流す
3. **ゲームで反映**: 設定の「オンライン連携」で「承認を再確認」を押す（またはログインし直す）→ 状態が「連携中」になり、その下に「メンバー管理」が出る
4. 以後の承認はすべてゲームの中で: 相手がログインすると「承認待ち」に載る →「承認」（1 タップ）/「却下」（1 タップ）。承認済みの人は「取り消し」（確認ダイアログあり）。却下・取り消しした人をもう一度承認するときは、上の 6 の付与の SQL を使う

### 承認待ちの人が「メンバー管理」に出ないとき（7-4d）

- **「このメールは登録できません。管理者に連絡してください」と出る**: Auth の新規登録（Authentication → Sign In / Providers → Allow new users to sign up）が無効で、そのメールのユーザーがまだ無い（`/auth/v1/otp` が 422）。ログインできていないので申請も入らない。このプロジェクトは 8-1 の時点で新規登録を ON にしているので、普段は出ない。出たら、まず新規登録が ON のままか確かめる（設定はプロジェクト共通（規約 3.3）なので、変えるときは規約の版の変更点に書いてから）
  - **代わりの手段（新規登録を OFF にしている場合）**: 持ち主が **Authentication → Users → Add user → Create new user**（メールと、使わない長いパスワード。Auto Confirm User を ON。または Send invitation）でユーザーを作る → 相手にもう一度「コードを送る」からログインしてもらう → 承認待ちに載る。この場合のメールは Magic Link のテンプレート
- **コードが届かない・メールにコードが無い**: 迷惑メールフォルダを確かめる。メールにリンクしか無いときは、その人に届いたテンプレート（初めての人は Confirm sign up、2 回目からは Magic Link）に `{{ .Token }}` が無い
- **「申請の送信に失敗しました（理由: …）」と出る**: 申請（`skyraid.join_requests` への insert）がサーバーに断られた。理由の「サーバーが拒否（権限・RLS）」は 0002 が流れていない・権限が外れている、「ログインが確立していない」はセッションが無い。ブラウザの console に `[skyraid] join_requests insert failed` とサーバーのエラーコードが出る。まず次の SQL で 0002 の権限とポリシーを確かめ、足りなければ `skyraid_0002_members.sql` を流し直す（冪等）

  ```sql
  select version from skyraid.schema_migrations order by version;            -- skyraid_0002_members がある
  select has_table_privilege('authenticated', 'skyraid.join_requests', 'insert') as can_insert,
         has_table_privilege('authenticated', 'skyraid.join_requests', 'select') as can_select;  -- 両方 true
  select policyname, cmd, roles from pg_policies where schemaname = 'skyraid' and tablename = 'join_requests';
  select user_id, display_name, status, requested_at from skyraid.join_requests order by requested_at desc;
  ```

- SQL の挙動は手元の Postgres 16 で Supabase のロールを模して確かめられる（`supabase/tests/run.sh`。使い方はファイルの先頭）。承認前のユーザーが申請でき・他人の行は見えず・owner の一覧に載ることと、上の owner の付与の SQL を確かめる

### ネフィルガのランキング（9-6c。まだ流していなければ）

ネフィルガ（2 体目の怪獣）のソロのクリアをランキングに載せるには、記録の key に `nephirga:normal`・`nephirga:hard` を足す SQL が要ります。**流すまでは、ゲームはネフィルガの記録を送らず、ランキングにも怪獣の選択を出しません**（ローカルの自己ベストには残ります。流す前のクリアはランキングに載りません）。

1. **SQL を流す**: SQL エディタに `supabase/migrations/skyraid_0003_raid_kaiju.sql` の全文を貼り付けて実行。もう一度そのまま実行してもエラーにならないことも確かめる（冪等）。変えるのは `skyraid.records` の key の check だけ（今の記録はそのまま通る）

   ```sql
   begin;
   alter table skyraid.records drop constraint if exists records_key;
   alter table skyraid.records add constraint records_key check (
     (kind = 'race' and key in ('coast', 'canyon', 'harbor-speed', 'acro'))
     or (kind = 'raid' and key in ('normal', 'hard', 'nephirga:normal', 'nephirga:hard'))
     or (kind = 'defense' and key in ('island:normal', 'island:hard', 'harbor:normal', 'harbor:hard'))
   );
   insert into skyraid.schema_migrations (version) values ('skyraid_0003_raid_kaiju') on conflict do nothing;
   commit;
   ```

2. **確かめる**: `select version from skyraid.schema_migrations order by version;` に `skyraid_0003_raid_kaiju` がある。`select pg_get_constraintdef(oid) from pg_constraint where conname = 'records_key';` に `nephirga:normal` が入っている
3. **ゲームで有効にする**: `src/data/online.ts` の `RANKED_RAID_KAIJU` に `'nephirga'` を足して公開する（流したことを伝えてもらえれば、こちらで足します）。ランキングの「レイド」に怪獣（ヴォルガス / ネフィルガ）の選択が出て、ネフィルガのソロのクリアが送られるようになる

### 確かめること（連携中になった後）

- レースを完走・ソロのレイドをクリア・ソロの防衛戦を終える →「ランキング」に自分の行がハイライトで出る（キャッシュは 5 分。表示名を変えたときと記録を送ったときはすぐ取り直す）
- 2 台目の端末（または別のブラウザ）で同じメールでログイン → 1 台目のセーブを受け取るか「どちらのセーブを使いますか？」が出る
- 「オンライン連携 OFF」にすると送信・同期・ランキングが止まる（モード選択の「ランキング」が消える）。ログインは残る
- SQL エディタで `select kind, key, count(*) from skyraid.records group by 1, 2;` と `select user_id, version, size_bytes, updated_at from skyraid.saves;`

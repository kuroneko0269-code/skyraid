# SkyRaid — CLAUDE.md

ブラウザで動く3Dフライトシューティング「SkyRaid（正式名：SkyRaid: Titan Skies）」のリポジトリ。
作業前に必ず `docs/spec.md`（仕様）と `docs/plan.md`（フェーズ計画）を読むこと。

## 技術スタック（変更禁止。変更したい場合は提案に留め、実装しない）

- 言語: TypeScript 6.x（strict）。7 系は typescript-eslint が対応するまで保留（`docs/decisions.md` 参照）
- ビルド: Vite
- 3D: Three.js（`three` 本体と `three/examples/jsm` のみ。追加の3Dライブラリは入れない）
- 物理: 自前の簡易アーケード物理（物理エンジンライブラリは使わない）
- 通信（フェーズ5以降）: PeerJS による P2P。ホストがゲーム状態の正（authoritative）
- セーブ: localStorage（フェーズ3）→ Supabase（フェーズ7以降、指示があるまで入れない）
- テスト: Vitest（ロジックのみ。描画はテストしない）
- 公開: Cloudflare Pages（`npm run build` → `dist/`）。ビルド・テスト・公開に GitHub Actions は使わない（v1.0.1 からタグ・リリース・claude/* のブランチの掃除だけ `.github/workflows/` に任せる）

## コマンド

```
npm ci          # 依存インストール
npm run dev     # 開発サーバー
npm run build   # 本番ビルド（push 前に必ず通す）
npm run check   # tsc --noEmit && eslint .
npm test        # vitest
npm run bench   # 時間の計測（テストには時間の判定を入れず、ここで測る。8-1）
npm run unused  # 使われていないコード・依存の検出（knip。8-1）
npm run analyze-replay -- <.skyreplay かフォルダ>  # リプレイの操作の診断（9-1。docs/control-analysis.md）
npm run perf    # 本番ビルドのチャンク一覧・起動時間・Lighthouse・起動の量の上限（8-2 / 10-1。結果は perf-report/。docs/perf.md）
node scripts/startup-breakdown.js [出力先]  # タイトルまでに読む量の機能ごとの内訳（10-1）
node scripts/ui-audit.js <出力先> --release [--browser all]  # 公開前の点検（build の後。docs/release-checklist.md。互換性は docs/compat.md）
node scripts/ui-audit-device.js <出力先>  # 実機確認の修正の点検（8-6。タップのずれ・画面の端・メンバー管理の行・排気口）
npm run format  # prettier --write .（整形。*.md は対象外）
```

## ディレクトリ構成

```
src/
  main.ts            エントリ
  core/              ループ、入力、時間、イベントバス、設定
  render/            シーン、カメラ、ライティング、ポストエフェクト、空・地形
  entities/          機体、ミサイル、敵、怪獣（データ + 更新ロジック）
  flight/            飛行モデル（物理）
  combat/            武装、ダメージ、当たり判定
  ai/                敵機AI、怪獣AI
  missions/          ミッション定義とランナー
  progression/       お金、アイテム、強化、セーブ
  net/               P2P同期（フェーズ5以降）
  ui/                HUD、メニュー、ハンガー（DOM + CSS。Reactは使わない）
  data/              機体・武器・ミッションの定義データ（JSON/TS）
public/assets/       モデル(glb)、テクスチャ、音
docs/                仕様・計画・決定記録
tests/               vitest
```

## コーディング規約

- 1ファイル300行を目安。超えたら分割する
- ゲームロジックと描画を分ける。`entities/` `flight/` `combat/` `ai/` は Three.js に依存しない（Vector3 等の数学型は可）
- 固定タイムステップ（60Hz）で更新、描画は可変。`core/loop.ts` に集約
- 数値パラメータ（速度、ダメージ、価格など）はコードに埋めず `src/data/` に置く
- `any` 禁止。`as` キャストは最小限
- 日本語コメントOK。関数名・変数名は英語
- 依存パッケージの追加は理由をコミット本文と完了報告に書く。大きなライブラリは避ける

## パフォーマンス予算

- 目標: ノートPC内蔵GPUで60fps、スマホで30fps
- 1フレームの draw call 300以下、三角形 100万以下
- アセットは1ファイル 25MB 以下（Cloudflare Pages制限）。glb は Draco 圧縮、テクスチャは 2048px 以下
- 毎フレームの `new Vector3()` 等のアロケーションを避け、再利用する
- シャドウマップ・ポストエフェクトは品質設定で切れるようにする

## アセットのルール

- 使えるのはライセンスが明確な無料素材のみ（CC0 / CC-BY）。出典を `docs/assets.md` に記録する
- 実在の商標・キャラクター（ゴジラ等）は使わない。怪獣はオリジナルデザイン
- 当面はプリミティブ（Box/Cone など）のプレースホルダーで実装を進め、見た目は後で差し替える

## 作業の進め方（クラウドセッション）

1. セッション開始時に必ず `npm ci` を実行する（セットアップスクリプトは使わない）
2. 与えられたタスクを `docs/plan.md` のどの項目に当たるか確認し、範囲外の作業はしない
3. 実装前に変更方針を短く提示し、大きな設計判断は `docs/decisions.md` に追記する
4. 作業単位は「1セッション＝1機能」。複数機能を1コミットに混ぜない
5. PR は作らない。作業ブランチで実装し、完了したら main に squash マージして push する
6. push 前に `npm run check` と `npm run build` と `npm test` が通ることを再確認する
7. 画面の確認は人間が Cloudflare のプレビューURLで行う。完了時にチャットで「変更概要 / 追加パッケージと理由 / 確認してほしい点 / 操作方法」を報告する
8. `docs/plan.md` の該当項目を `[x]` にし、main のコミットへのリンクを書く
9. コミットは Conventional Commits（`feat:` `fix:` `refactor:` `docs:` `chore:`）。squash マージのコミットも同様
10. ブランチ名: `feat/<topic>` `fix/<topic>`。クラウドセッションが自動で付ける `claude/<auto>` も可
11. 不明点は推測で進めず、選択肢を挙げて質問する
12. main に squash マージして push した後、作業ブランチを main に揃える force push は行わない（権限で拒否される。作業ブランチは squash 前のままで良い）

## 更新履歴

- 遊ぶ人に見える変更（機能・画面・文言・数値の変更、不具合の修正）は、タスクごとに `docs/changelog.md` の今の版の項に「- 」で追記する（アプリの「情報 → 更新履歴」に出る）。内部だけの変更（リファクタ・テスト・ドキュメント）は書かない
- 書式は「## 版（日付）」の見出しと「- 」の箇条書きだけ（`src/core/changelog.ts` が読む）。新しい版は上に足す
- 1.0.0 より前の版はフェーズの番号（0.N.0 = フェーズ N）。新しいフェーズの最初のタスクで `package.json` の version を上げ、新しい項を作る（`npm version 0.N.0 --no-git-tag-version`）
- 1.0.0 の後（フェーズ 9 から）: 遊ぶ人に見える変更を含むタスクごとに 1.0.x を 1 つ上げ（`npm version patch --no-git-tag-version`）、changelog に新しい項を作る。ツール・文書・テストだけのタスクと、未完成で隠している機能だけのタスクは上げない。フェーズ 9 の完了（9-11）で 1.1.0
- 1.1.0 の後（フェーズ 10 から）: 当分は 1.2.0 に上げず、遊ぶ人に見える変更を含むタスクごとに 1.1.x を 1 つ上げる（`npm version patch --no-git-tag-version`）。changelog に新しい項を作る。上げないタスクはフェーズ 9 と同じ
- 未完成の機能は `?dev=<名前>` の URL フラグの裏に隠す（フラグが無ければ遊ぶ人には見えない。changelog には出す時に書く）
- 1 つの版は 3〜5 行を目安に、細かい修正はまとめる

## やってはいけないこと

- GitHub Actions のワークフロー追加（v1.0.1 の release.yml・cleanup-branches.yml を除く。直すのは指示があったときだけ）
- 秘密情報（APIキー等）のコミット。`.env` は `.gitignore` 済み
- 指示のないフェーズの機能を先回りして実装すること
- 既存の操作感（飛行モデルの数値）を無断で変えること。変える場合はコミット本文と完了報告に理由と変更前後の値を書く

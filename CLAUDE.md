# SkyRaid — CLAUDE.md

ブラウザで動く3Dフライトシューティング「SkyRaid（正式名：SkyRaid: Kaiju Front）」のリポジトリ。
作業前に必ず `docs/spec.md`（仕様）と `docs/plan.md`（フェーズ計画）を読むこと。

## 技術スタック（変更禁止。変更したい場合は提案に留め、実装しない）

- 言語: TypeScript（strict）
- ビルド: Vite
- 3D: Three.js（`three` 本体と `three/examples/jsm` のみ。追加の3Dライブラリは入れない）
- 物理: 自前の簡易アーケード物理（物理エンジンライブラリは使わない）
- 通信（フェーズ5以降）: PeerJS による P2P。ホストがゲーム状態の正（authoritative）
- セーブ: localStorage（フェーズ3）→ Supabase（フェーズ7以降、指示があるまで入れない）
- テスト: Vitest（ロジックのみ。描画はテストしない）
- 公開: Cloudflare Pages（`npm run build` → `dist/`）。GitHub Actions は使わない

## コマンド

```
npm ci          # 依存インストール
npm run dev     # 開発サーバー
npm run build   # 本番ビルド（PR前に必ず通す）
npm run check   # tsc --noEmit + eslint
npm test        # vitest
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
- 依存パッケージの追加は理由をPR本文に書く。大きなライブラリは避ける

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

1. 与えられたタスクを `docs/plan.md` のどの項目に当たるか確認し、範囲外の作業はしない
2. 実装前に変更方針を短く提示し、大きな設計判断は `docs/decisions.md` に追記する
3. 作業単位は「1セッション＝1機能」。複数機能を1PRに混ぜない
4. PR前に `npm run check` と `npm run build` と `npm test` を通す
5. 画面の確認は人間が Cloudflare のプレビューURLで行う。PR本文に「確認してほしい点」と「操作方法」を必ず書く
6. コミットは Conventional Commits（`feat:` `fix:` `refactor:` `docs:` `chore:`）
7. ブランチ名: `feat/<topic>` `fix/<topic>`
8. 不明点は推測で進めず、選択肢を挙げて質問する

## やってはいけないこと

- GitHub Actions のワークフロー追加
- 秘密情報（APIキー等）のコミット。`.env` は `.gitignore` 済み
- 指示のないフェーズの機能を先回りして実装すること
- 既存の操作感（飛行モデルの数値）を無断で変えること。変える場合はPR本文に理由と変更前後の値を書く

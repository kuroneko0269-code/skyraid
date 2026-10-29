# 設計判断の記録

| 日付 | 判断 | 理由 |
| --- | --- | --- |
| 2026-10-29 | 通信は P2P（PeerJS）、ホストが正 | サーバー費ゼロ。1〜4人の友人プレイが前提 |
| 2026-10-29 | 物理は自前のアーケード式 | 操作感を優先。ライブラリより調整が容易 |
| 2026-10-29 | GitHub Actions は使わない | 他プロジェクトで無料枠を消費済み。Cloudflare Pages の連携ビルドで代替 |
| 2026-10-29 | 0-1 時点の `npm run check` は `tsc --noEmit` のみ。ESLint は 0-2 で追加し `check` に組み込む | plan.md で ESLint 設定は 0-2 の範囲のため |
| 2026-10-29 | ESLint は flat config（`eslint.config.js`）+ typescript-eslint の `strictTypeChecked` + `eslint-config-prettier` | ESLint 9 以降は flat config が標準で、旧 `.eslintrc` は ESLint 10 で廃止済み。型情報付きルールで `any` 混入や浮いた Promise を検出する。整形は Prettier に任せ、ESLint の整形系ルールは eslint-config-prettier で無効化して衝突を防ぐ |
| 2026-10-29 | Prettier は `*.md` を対象外にする | Markdown の表を桁揃えすると日本語の表が差分だらけになり、docs のレビューがしにくいため |
| 2026-10-29 | TypeScript は 6.x（`~6.0.3`）を使う。7 系は typescript-eslint が対応したら戻す | TS 7（Go 製ネイティブ版）は JS API を持たず、typescript-eslint 8.72 の peer 依存は `typescript >=4.8.4 <6.1.0`。`~` にしたのは 6.1 が出ても peer 範囲外へ上がらないようにするため |
| 2026-10-29 | `core/loop.ts` は固定 60Hz 更新 + 可変描画（accumulator 方式）。1フレームの実時間は 0.25 秒でクランプ | 物理の再現性と P2P 同期（フェーズ5）のため更新間隔を固定。タブ復帰時の巨大 dt で更新が暴走するのを防ぐ。rAF はインターフェース越しに注入しテスト可能にする |
| 2026-10-29 | キー割当は `KeyboardEvent.code` で定義し、ゲーム側はアクション名で取得する | `code` は配列レイアウト（JIS/US）に依存しない物理位置。アクション名経由にしてタッチ・ゲームパッド（1-5）を同じ API に足せるようにする |

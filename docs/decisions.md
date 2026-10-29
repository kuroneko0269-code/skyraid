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
| 2026-10-29 | 品質設定は low / medium / high の3段階。各段階は「シャドウ有無・ピクセル比上限・ポストエフェクト有無・描画距離」を持ち、数値は `src/data/quality.ts`。medium のピクセル比上限は 1.5（0-1 では一律 2） | 内蔵GPUで60fpsの予算を守るため、高解像度ディスプレイでの描画コストを中で抑える。霧の範囲は描画距離に対する比（0.1 / 0.7）で決め、medium の描画距離 5000 で 0-1 と同じ見た目になる |
| 2026-10-29 | 初期品質は「保存した手動設定 > タッチ端末（`(pointer: coarse)`）または低性能 GPU 名（SwiftShader・llvmpipe・Mali・Adreno・PowerVR など）なら low > それ以外は medium」。high は自動では選ばない | `maxTouchPoints` だとタッチ対応ノートPCまで low になるため主ポインタで判定する。GPU 名だけで高性能と言い切るのは難しいので、自動で上げるのは medium まで |
| 2026-10-29 | 品質設定は localStorage に文字列（`skyraid.quality` = `low` 等）で保存し、読めない・不正な値は自動判定にフォールバック。アクセスはすべて try/catch | Safari のプライベートモードやストレージ無効化で例外になるため。セーブデータのスキーマ（3-1）とは別キーにして、設定だけ先に入れられるようにする |
| 2026-10-29 | レンダラーへの適用は `src/render/pipeline.ts`（`RenderPipeline`）に集約。core/ は Three.js を参照せず、品質の選択と通知（`QualitySettings`）だけを持つ。シャドウとポストエフェクトは現時点では ON/OFF のフラグ受け口のみ | CLAUDE.md の「ロジックと描画を分ける」。本体はフェーズ4で `RenderPipeline.render()` に足す |
| 2026-10-29 | デバッグ表示は F3 で切替、初期は非表示。URL に `?debug`（値は問わない。`?debug=input` を含む）で初期表示。fps / frame ms は 0.5 秒ごとの平均 | `?debug=input` の入力ログはそのまま残し、デバッグ時は両方見られる方が便利なため。毎フレームの値は揺れて読めず、DOM 更新も減らせる |

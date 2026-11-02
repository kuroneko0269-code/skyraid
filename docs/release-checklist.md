# 公開前の点検リスト

公開（または大きな更新）の前に上から順に確かめる。結果の欄は直近の実施（8-1・v0.8.0・2026-11-02）。
クラウドのセッションで確かめられない項目は「実機で確認」と書き、人間がプレビュー URL と実機で確かめる。

## 手順

```
npm ci
npm run check && npm test && npm run build     # 型・lint・テスト・本番ビルド
npm run bench                                  # 時間の計測（スキンの生成 50ms 以内）
npm run unused                                 # 使われていないコード・依存（knip）
npm run perf                                   # チャンク一覧・起動時間・Lighthouse（8-2。docs/perf.md）
node scripts/ui-audit.js <出力先> --release [--browser all]  # 本番ビルド（dist）を _headers 付きで配信して点検（Playwright。8-3: エンジンの選択と互換性）
npm run dev & node scripts/ui-audit.js <出力先> # 3 サイズの UI の点検（開発サーバー）
# 8-4: どちらも --lang en で英語の画面を点検する（既定は日本語）
```

`--release` は `.env` が無い（環境変数なし）状態でビルドした `dist` に対して走らせる。結果は `<出力先>/release.json` と各画面の PNG。

## 結果（v0.8.0）

| # | 項目 | 確かめ方 | 結果 |
| --- | --- | --- | --- |
| 1 | 全モードを 844×390 で通しで起動 | `--release`（タッチ端末・844×390）。チュートリアル / キャンペーン M1 / フリーフライト / リングレース / レイド（ソロ）/ 防衛戦（ソロ）は飛行 → ポーズまで。PvP / レイド協力 / 防衛戦協力はロビー画面まで。`?net=local` で PvP の部屋を作りロビーの部屋まで。ハンガー・リプレイ一覧も開く | ✅ 12 / 12 |
| 2 | console エラー 0 | `--release` の全画面で console の error・ページの例外・HTTP 400 以上 | ✅ 0 件（BGM の受け口が無い曲を読みに行く 404 が 1 画面 3 件あったのを直した） |
| 3 | CSP 違反 0 | `dist/_headers` の CSP をそのまま付けて配信し、`securitypolicyviolation` を数える | ✅ 0 件 |
| 4 | 空の状態からの初回起動 | 新しいブラウザのコンテキストで、アプリを読む前に localStorage 0 件・IndexedDB 0 個を確かめ → タイトル → パイロット名 → モード選択に「チュートリアルを始めますか？」 | ✅ 起動後に作られるのは `skyraid.save`・`skyraid.launches` と IndexedDB の `skyraid-replays` |
| 5 | セーブ v1〜v9 の移行 | `tests/save-migration-chain.test.ts`（v1〜v9 のどの版の JSON からも v9 に移行し、各版で足した値が残る）と各段のテスト（save / hangar / difficulty-assist / controls / race-save / replay-save-v7 / skins / menu） | ✅ 全部通る |
| 6 | PWA: manifest・アイコン | `--release`: manifest（standalone・landscape）、アイコン 192 / 512 / maskable 512 の実寸がマニフェストと一致、apple-touch-icon | ✅ |
| 7 | PWA: オフライン起動 | `--release`: Service Worker がページを制御した後にオフラインにして読み直し → タイトル → フリーフライトまで | ✅ |
| 8 | 環境変数なしのビルドでオンライン機能が隠れる | `--release`: 「ランキング」のタイル・設定の「オンライン連携」が無い、`dist/_headers` の connect-src に Supabase が無い、ページから Supabase・online-app への通信 0 件 | ✅ |
| 9 | 情報画面 | `--release`: 版 0.8.0、更新履歴 0.8.0〜0.1.0、ライセンス 21 件（three・peerjs・@supabase/supabase-js・workbox・Rajdhani を含む。本文 20 件）が本番ビルドで生成されている。データの扱い（セーブはブラウザ内・オンライン連携は任意でメールと表示名だけ・P2P は相手に IP が見える） | ✅ |
| 10 | UI の 3 サイズ | `scripts/ui-audit.js`（568×320・844×390・1920×1080） | ✅ 折り返し・はみ出し・重なり 0。568×320 のモード選択のカードの説明が「…」で切れる警告は 7-D からのもの。8-4: 英語（`--lang en`）でも同じ（同じ 4 枚の「…」の警告だけ） |
| 11 | 依存の脆弱性 | `npm audit --omit=dev` | ✅ 配信する依存は 0 件（開発用の eslint・workbox-build に moderate 21 件。配信物には入らない） |
| 12 | 時間の計測 | `npm run bench` | ✅ スキンの生成 最大 約 40ms（上限 50ms） |
| 13 | 容量（8-2） | `npm run build` の 500KB 超の警告・`npm run perf` | ✅ 警告なし（最大 `three-webgl` 371KB）。タイトルまでの JS・CSS は gzip 393KB（8-1 は 412KB） |
| 14 | 互換性（8-3） | `--release` の compat: WebGL / WebGL 2 が無い・古いブラウザの案内、コンテキスト喪失 → ポーズ → 復帰、保存できない（localStorage の例外・容量超過）のお知らせ、音・全画面・向き・振動が無い、縦向きの案内、ゲームパッドの抜き差し。表と実機の手順は `docs/compat.md` | ✅ Chromium 10 / 10（Firefox・WebKit はクラウドで取得できず未実施。実機の手順は docs/compat.md） |

## 実機で確認（クラウドでは確かめられない）

| 項目 | 確かめること | 結果 |
| --- | --- | --- |
| Cloudflare Pages の配信 | プレビュー URL の応答ヘッダーに `_headers` の CSP などが付く。DevTools の console にエラー・CSP 違反が無い（Google Fonts を実際に読む） | 実機で確認 |
| オンライン連携の実通信 | 環境変数を入れたビルドで、初めてのメールで「コードを送る」→ Confirm sign up のメールにコード → ログイン → 承認待ち → 承認 → 連携中。パイロット名を変えるとランキングの表示名も変わる | 実機で確認 |
| P2P の実通信 | 別々の端末・回線で PvP・協力レイド・協力防衛戦の部屋を作って参加し、飛行・撃墜・リザルトまで（PeerJS のシグナリングと WebRTC） | 実機で確認 |
| ホーム画面に追加 | iOS の Safari の「ホーム画面に追加」・Android の Chrome のインストールで全画面・横向きで起動し、アイコンが正しい。機内モードでも起動する | 実機で確認 |
| 更新の知らせ | 新しい版をデプロイした後、開いているアプリに「新しいバージョンがあります」が出て、次の起動で切り替わる | 実機で確認 |
| 実機の性能 | ノート PC の内蔵 GPU で 60fps・スマホで 30fps、起動時間（クラウドの値は参考値。`docs/perf.md`） | 実機で確認 |
| 振動・タッチ | Android の振動、iPhone のタッチ操作とセーフエリア | 実機で確認 |

## 見つかったこと（今回は直していない）

- ~~レイド・防衛戦の「協力 2〜4人」から入るロビーの見出しが「PvP / 2〜4 人で同じ空を飛ぶ」のまま~~ → 8-2 の事前修正で「協力レイド」「協力防衛戦」に（`src/ui/lobby-text.ts`・i18n の `lobby`）
- ~~Service Worker が環境変数なしのビルドでも `online-app`（約 250KB、Supabase を含む）をプリキャッシュする~~ → 8-2 の事前修正で、環境変数なしのビルドではプリキャッシュしない
- ~~`public/brand/icon-source.png`（1254px・約 1.3MB）が `dist` に入って配信される~~ → 8-2 の事前修正で `assets-src/brand/` に移した（アイコン生成の入力としてリポジトリに残す）

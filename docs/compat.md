# 互換性（8-3）

ブラウザ・端末ごとの対応と、機能が無い・失敗するときの動き。決定は `docs/decisions.md` の 8-3、仕様は `docs/spec.md` の「互換性（8-3）」、文面と数値は `src/data/compat.ts`。

## 最低動作環境（推奨案 A を採用）

| 端末 | 最低の版 | 決め手 |
| --- | --- | --- |
| iPhone / iPad | iOS / iPadOS 16.4 以降の Safari（ホーム画面のアプリも同じ） | three の class の static ブロック（ES2022）が Safari 16.4 から |
| Android | Chrome 105 以降 | static ブロックは Chrome 94 から。設定の選択欄の枠に使う CSS の `:has()` が 105 から |
| パソコン | Chrome / Edge 105 以降・Safari 16.4 以降・Firefox 121 以降 | 同上（Firefox は static ブロック 93・`:has()` 121） |

- 共通: WebGL 2（iOS 15・Chrome 56・Firefox 51 から）。ブラウザのハードウェア アクセラレーションが OFF だと使えない
- ビルドの `target` は `es2022`（`vite.config.ts`）。出力の構文で下限を決めるのは three の static ブロック（class のフィールド・`??=` などほかの構文は下限より前の版から使える）
- 使っている API で下限より新しいものは無い。無くても動くよう確かめてから使っているもの: `Intl.Segmenter`（パイロット名の文字数）・Vibration・Fullscreen・Screen Orientation の lock・Gamepad・Web Share（フォトモードの共有）・`OffscreenCanvas`（three）
- polyfill は入れない（下限の版はどれも使っている API を持つため。下限を下げるなら polyfill ではなく構文の変換が要る → 案 B）

| 案 | 内容 | 長所 | 短所 |
| --- | --- | --- | --- |
| **A（採用）** | 今のビルドのまま、上の表を下限にする | ビルド・見た目・挙動が変わらない。iOS 16.4 は iPhone 8 / X 以降が入れられる | iOS 15 の端末（iPhone 6s / 7・初代 SE）は遊べない（案内画面は出る） |
| B | `build.target` を `['es2021', 'safari15']` にして static ブロックを変換し、iOS 15.4 まで広げる | 古い iPhone も対象 | three の出力が変わる。iOS 15 の WebGL 2 は不具合が多く、実機で確かめられない |
| C | 下限を書かず「最新の 2 版」とする | 書き直しが要らない | 古い端末の人に何が足りないか示せない |

## 互換性の表

クラウドの結果 = `node scripts/ui-audit.js <出力先> --release --browser all`（2026-11-02、Chromium のソフトウェア描画。Firefox・WebKit は取得できず未実施 → 下の「3 エンジンの点検」）。実機で確認 = 人間が確かめる手順（1 行ずつ）。

| 項目 | 期待する動き | クラウドの結果 | 実機で確認（手順） |
| --- | --- | --- | --- |
| WebGL が無い | 案内画面「3D の描画（WebGL）が使えません」と動作環境・「再読み込み」。真っ黒にしない | ✅ noWebGL（変更前は例外で真っ黒） | パソコンの Chrome の設定 → システム →「グラフィック アクセラレーションが使用可能な場合は使用する」を OFF → 再起動して開く → 案内が出る（確かめたら ON に戻す） |
| WebGL 2 が無い（WebGL 1 はある） | 案内画面「WebGL 2 に対応していません」 | ✅ noWebGL2（変更前は真っ黒） | 手元に iOS 14 以前の端末があれば Safari で開く → 案内が出る（無ければ省略） |
| 古いブラウザ（構文を読めない） | `public/legacy-check.js` の案内「このブラウザは古いため起動できません」 | ✅ legacy | iOS 16.3 以前の端末があれば Safari で開く → 案内が出る（無ければ省略） |
| WebGL のコンテキスト喪失 | ソロの飛行中はポーズ。戻ったら描画が続き、機体の映り込みも元どおり。5 秒戻らなければ「再読み込み」のお知らせ | ✅ contextLost（変更前は喪失中も判定が進み墜落していた） | iPhone でフリーフライト中にホーム画面へ → 1 分ほど別のアプリ（カメラなど重いもの）→ 戻る → ポーズで止まっていて、再開すると空・海・機体が正しく描かれる |
| localStorage が使えない | 遊べる。起動時に「この環境ではデータを保存できません…」を 1 回 | ✅ noStorage（変更前はお知らせなし） | パソコンの Firefox の設定 → プライバシー → Cookie とサイトデータを「すべてブロック」→ 開く → お知らせが出てフリーフライトまで遊べる（確かめたら戻す） |
| 容量超過（書き込みの失敗） | 最初に書けなかったときにお知らせを 1 回 | ✅ quota（変更前はお知らせなし） | クラウドの点検のみ（実機で容量を埋めるのは難しい） |
| Safari のプライベートブラウズ | iOS 16.4 以降は localStorage・IndexedDB が使える（閉じると消える）ので、普通に遊べてお知らせは出ない | —（WebKit を取得できず未実施） | iPhone の Safari でプライベートのタブ → 開く → 名前を入れてフリーフライト → リザルトまで例外なし。タブを閉じて開き直すと名前の入力から |
| IndexedDB が使えない（リプレイ） | リプレイの一覧は空で開き、保存しない。ほかは遊べる | ✅ noStorage（変更なし。7-B から） | 上の Firefox の「すべてブロック」でリプレイの一覧が空で開く |
| 音: 最初のタッチまで止まっている（iOS） | 最初の操作（タップ・キー）で AudioContext を作って鳴る。止まっていれば操作のたびに resume | ✅ noAudio（AudioContext が無くても例外なし。変更なし） | iPhone の Safari で開いてタップ → タイトルの音が出る（消音スイッチが OFF のとき） |
| 音: 裏から戻る | 裏に回ると suspend、戻ると resume。戻しで鳴らなければ次のタップで鳴る | —（変更なし。4-4） | iPhone で飛行中にホームへ → 戻る → エンジン音が戻る（鳴らなければ 1 回タップで戻る）。電話・アラームの割り込みの後も同じ |
| 全画面が無い（iPhone の Safari） | 設定 → 表示に「全画面」のボタンを作らない。例外なし | ✅ noDeviceApi（変更なし。4-10） | iPhone の Safari で設定 → 表示 →「全画面」が無い。Android の Chrome では「全画面」で全画面 + 横向きに固定 |
| 画面の向きの固定が無い | 全画面の後の固定に失敗しても無視 | ✅ noDeviceApi（変更なし） | iPad の Safari で「全画面」→ 例外なく全画面（向きは固定されない） |
| 振動が無い | 「振動（Android のみ。この端末は非対応）」で押せない | ✅ noDeviceApi（変更なし。4-11） | iPhone で設定 → 操作 → 振動が押せない。Android で ON にして被弾で震える |
| 縦向き | スマホ（タッチ・幅 600px 以下）の縦画面はどの画面でも「画面を横にしてください」。iPad の縦・パソコンは出さない | ✅ portrait（変更前は飛行中だけで、メニューは縦で崩れていた） | iPhone を縦にしてタイトル・モード選択・飛行 → 案内が出る → 横にすると消えて続きから。iPad の縦では出ない |
| ノッチ・ホームバーの安全領域 | ボタン・HUD を safe-area の内側に置く（`--ui-safe-*`。ホーム画面のアプリはステータスバーの下まで描く） | —（クラウドでは env(safe-area-inset-*) が 0 のため確かめられない。変更なし。4-10） | ノッチのある iPhone の横画面で、タイトル・モード選択・ポーズ・HUD・タッチのボタンがノッチとホームバーにかからない（ブラウザとホーム画面のアプリの両方） |
| タッチ | タッチ端末で飛行中だけスティックとボタン | ✅ 全モードの点検（844×390 のタッチ端末） | iPhone・Android でフリーフライト → 左スティックで操縦・射撃・ミサイル・ポーズ |
| キーボード・マウス | キーで操作。タップ / クリックで対象を選ぶ | ✅ 全モード（Esc でポーズ） | パソコンでフリーフライト → キーで操作・Esc でポーズ・クリックで対象を選ぶ |
| ゲームパッドの抜き差し | 接続で使える。切断で入力を離す（舵が残らない）。再接続で戻る | ✅ gamepad（偽物のパッド。変更なし。1-5） | パソコンにパッドをつないで飛行 → スティックを倒したまま抜く → 機体が真っすぐに戻る → 挿し直す → 操作できる |

## 3 エンジンの点検

```
npm run build
node scripts/ui-audit.js <出力先> --release --browser all     # chromium / firefox / webkit を <出力先>/<エンジン>/ に
node scripts/ui-audit.js <出力先> --release --browser webkit  # 1 つだけ
```

- 取得していないエンジンは飛ばして「取得できない（実行ファイルが無い）」と出し、`<出力先>/browsers.json` に残す。手元では `npx playwright install firefox webkit` で取得できる（Linux の WebKit は `npx playwright install-deps webkit` も）
- 2026-11-02 のクラウドのセッションでは、Playwright のブラウザの配布元（`cdn.playwright.dev`・`playwright.download.prss.microsoft.com`）がネットワークの方針で拒否され（403）、Firefox・WebKit を取得できなかった。Ubuntu の `firefox` パッケージは snap の入れ物だけで使えない
- WebKit（Playwright）は Safari と同じエンジンだが iOS の Safari そのものではない（タッチ・音の制限・ホーム画面のアプリ・メモリの上限は実機で確かめる）

| エンジン | 版 | 結果 |
| --- | --- | --- |
| Chromium | 153.0.8010.12（Playwright 1.63・ソフトウェア描画） | ✅ 全モード 12 / 12・初回起動・PWA・オンライン機能の非表示・情報画面・互換性 10 / 10、console エラー 0・CSP 違反 0 |
| Firefox | — | 取得できない（ネットワークの方針で配布元が 403） |
| WebKit | — | 取得できない（同上） |

## 点検の作り方（`scripts/ui-audit-compat.js`・`ui-audit-compat-device.js`）

どのエンジンでも同じになるよう、ブラウザの起動の設定ではなくページの init script で API を消す・投げる。

| 点検 | 作り方 |
| --- | --- |
| noWebGL / noWebGL2 | `HTMLCanvasElement.prototype.getContext` が `webgl2`（と `webgl`）に null を返す |
| legacy | `/assets/app-*.js` を構文エラーの中身にして返す（モジュールを読めない古いブラウザ） |
| contextLost | 飛行中に `WEBGL_lose_context.loseContext()` → 1 秒後に `restoreContext()`。再開後の空の明るさをスクリーンショットで測る |
| noStorage | `window.localStorage` の取得が `SecurityError`・`indexedDB` が undefined |
| quota | `Storage.prototype.setItem` が `QuotaExceededError` |
| noAudio | `AudioContext`・`webkitAudioContext` を消す |
| noDeviceApi | `fullscreenEnabled` が false・`requestFullscreen` / `screen.orientation` / `navigator.vibrate` が無い |
| portrait | 390×844 のタッチ端末。タイトルと飛行で案内、横向き（844×390）では出ない |
| gamepad | `navigator.getGamepads` を偽物にして `gamepadconnected` → 切断 → 再接続 |

# 怪獣の見た目の前後（10-7a・10-7b）

撮り方: `node scripts/kaiju-visual-pilot.js <nephirga|albion> <before|after> [--measure] [--quality low|medium|high]`（10-7b で怪獣ごとの共通の仕組みにした。`?dev=kshot`・`src/ui/kaiju-shot.ts`。場面は `src/data/<怪獣>-shots.ts`）。見た目だけの乱数（`Math.random`）は決まった種にして撮る。
クラウドには GPU が無く、ソフトウェアの描画で撮った絵（ブルーム・影は本物と同じ式だが、色の細かい違い・ちらつきは実機で確かめる）。

- [白鯨アルビオン（10-7b）](#白鯨アルビオン10-7b)
- [ネフィルガ: 共通の部品へ移した前後（10-7b）](#ネフィルガ-共通の部品へ移した前後10-7b)
- [ネフィルガの見た目の試作（10-7a）](#ネフィルガの見た目の試作10-7a)

## 白鯨アルビオン（10-7b）

画質「高」・同じ構図。左が変更前（10-3a〜10-4c の見た目）、右が変更後。
泳ぐ 3 枚は尾の打ちの 1/3 ずつ。尾びれの上下と後ろ半分のうねりは 10-3a からの判定の形（当たりも同じ式）なので変更前にもあり、変更後は打ちに合わせた体の上下の揺れ（0.8m）・機首の上下・尾びれの水の筋と打ち返しの渦・胸びれの舵を足した（描画だけの動きは当たりの形から 3m の中。docs/decisions.md の 10-7b）。

### 昼・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（雲の中から現れる。下から見上げる。演出の場面の中ほどの構図） | ![変更前](albion/before/day-entrance.webp) | ![変更後](albion/after/day-entrance.webp) |
| 周回（上から。体に沿って流れる雲・海の影） | ![変更前](albion/before/day-orbit.webp) | ![変更後](albion/after/day-orbit.webp) |
| 泳ぐ 1/3（尾びれが上。横から） | ![変更前](albion/before/day-swim0.webp) | ![変更後](albion/after/day-swim0.webp) |
| 泳ぐ 2/3（尾びれを打ち下ろす） | ![変更前](albion/before/day-swim1.webp) | ![変更後](albion/after/day-swim1.webp) |
| 泳ぐ 3/3（尾びれが下） | ![変更前](albion/before/day-swim2.webp) | ![変更後](albion/after/day-swim2.webp) |
| 曲がる（半円で傾く。胸びれの舵） | ![変更前](albion/before/day-turn.webp) | ![変更後](albion/after/day-turn.webp) |
| 潮吹き（しぶきと霧） | ![変更前](albion/before/day-spout.webp) | ![変更後](albion/after/day-spout.webp) |
| 吠える（口を開け、目と口の線が光る） | ![変更前](albion/before/day-roar.webp) | ![変更後](albion/after/day-roar.webp) |
| 部位の破壊（中の巣を壊した直後。破片と赤い霧） | ![変更前](albion/before/day-break.webp) | ![変更後](albion/after/day-break.webp) |
| 撃破（海へ落ちて水柱） | ![変更前](albion/before/day-defeat.webp) | ![変更後](albion/after/day-defeat.webp) |

### 夕方・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（雲の中から現れる。下から見上げる。演出の場面の中ほどの構図） | ![変更前](albion/before/evening-entrance.webp) | ![変更後](albion/after/evening-entrance.webp) |
| 周回（上から。体に沿って流れる雲・海の影） | ![変更前](albion/before/evening-orbit.webp) | ![変更後](albion/after/evening-orbit.webp) |
| 泳ぐ 1/3（尾びれが上。横から） | ![変更前](albion/before/evening-swim0.webp) | ![変更後](albion/after/evening-swim0.webp) |
| 泳ぐ 2/3（尾びれを打ち下ろす） | ![変更前](albion/before/evening-swim1.webp) | ![変更後](albion/after/evening-swim1.webp) |
| 泳ぐ 3/3（尾びれが下） | ![変更前](albion/before/evening-swim2.webp) | ![変更後](albion/after/evening-swim2.webp) |
| 曲がる（半円で傾く。胸びれの舵） | ![変更前](albion/before/evening-turn.webp) | ![変更後](albion/after/evening-turn.webp) |
| 潮吹き（しぶきと霧） | ![変更前](albion/before/evening-spout.webp) | ![変更後](albion/after/evening-spout.webp) |
| 吠える（口を開け、目と口の線が光る） | ![変更前](albion/before/evening-roar.webp) | ![変更後](albion/after/evening-roar.webp) |
| 部位の破壊（中の巣を壊した直後。破片と赤い霧） | ![変更前](albion/before/evening-break.webp) | ![変更後](albion/after/evening-break.webp) |
| 撃破（海へ落ちて水柱） | ![変更前](albion/before/evening-defeat.webp) | ![変更後](albion/after/evening-defeat.webp) |

### 重さ（怪獣だけ。怪獣を出して / 隠して描いた差）

場面ごとの値は `albion/before-<画質>.json` / `after-<画質>.json`（夕方の空・撮影の 6 場面で測った。泳ぐ・曲がるの場面を足す前）。draw call・三角形はシャドウの分を含む（「中」「高」はシャドウあり、「低」はなし）。

| | 低 変更前 | 低 変更後 | 中 変更前 | 中 変更後 | 高 変更前 | 高 変更後 |
| --- | --- | --- | --- | --- | --- | --- |
| 体の三角形（モデル） | 840 | 960（下あご・口 +120） | 3,316 | 3,628（+312） | 3,316 | 3,628（+312） |
| 描いた三角形（場面の最小〜最大） | 840〜936 | 960〜1,248 | 6,632〜6,728 | 7,466〜7,906 | 6,632〜6,728 | 7,714〜8,294 |
| draw call（場面の最小〜最大） | 1〜3 | 1〜5 | 2〜4 | 7〜11 | 2〜4 | 7〜11 |
| 作る絵（縮めた絵を含む） | 0 | 0 | 0 | 0.35MB（256 × 256 × 1 枚） | 0 | 1.4MB（512 × 512 × 1 枚） |
| 形を動かす時間（JS・中央値） | 測っていない | 0.1〜0.2ms | 測っていない | 0.1〜0.3ms | 測っていない | 0.1〜0.2ms |
| 1 フレームの時間（ソフトウェアの描画・目安） | 約 362〜450ms | 約 198〜242ms | 約 948〜1,696ms | 約 568〜1,017ms | 約 957〜2,277ms | 約 855〜1,322ms |

- draw call の内訳（「高」）: 体 1 + シャドウ 1 + 攻撃の効果 0〜2（10-3a のまま）+ 柔らかい粒（流れる雲・しぶき・水柱）1 + 水の筋 1 + 鳥 1 + 海の影 1 + 破片と煙 0〜2（出ているときだけ）。「低」は体 1 + 攻撃 0〜2 + 粒・破片（出たときだけ）
- 描く時間はクラウドのソフトウェアの描画（GPU なし）で、ほかの撮影と同時に動かしたのでばらつきが大きい。実機の GPU での重さは実機で確かめる（設定の「デバッグ表示」の fps・draw call）
- 起動の量（タイトルまでに読む JS・CSS）: gzip 290.4KB → 290.4KB（変わらない。上限 320KB）。アルビオンの遅延チャンク `albion-runtime`: JS gzip 21.3KB → 31.3KB（アルビオンを選んだときだけ読む）。ネフィルガと共通の部品のチャンク（シェーダーの部品・雨と風の筋・電気の弧・破片と煙・登場の場面）は JS 5.1KB・CSS 0.7KB で、どちらかを選んだときだけ読む
- 絵は起動時（アルビオンのチャンクを読んだとき）に作る。画質を変えると作り直す（同じ大きさは使い回す）

## ネフィルガ: 共通の部品へ移した前後（10-7b）

10-7a の絵・光・動き・演出・粒・撮影を共通の部品（`src/render/kaiju-look/`・`src/ui/kaiju-cinema.ts`・`kaiju-shot.ts`）へ移す前（10-7a の main）と後を、同じ構図・画質「高」・見た目だけの乱数を決まった種にして撮った。右の列は画素の違い（0〜255 の平均 / 24 より違う画素の割合）。
違いは、空の雲の流れ（撮るまでの時間で動く）と、乱数で決まる稲妻・電気の弧・雨の筋の場所だけ（乱数を種にしても、読み込みの間に使う回数がそろわない）。体の形・色・質感・光は同じ。判定の状態のハッシュが描画あり / なしで同じことは `tests/kaiju2-visual.test.ts`（10-7a のまま）が確かめる。

| 場面 | 移す前 | 移した後 | 違い |
| --- | --- | --- | --- |
| 昼・登場 | ![移す前](nephirga/refactor-before/day-entrance.webp) | ![移した後](nephirga/refactor-after/day-entrance.webp) | 1.4 / 0.7% |
| 昼・周回 | ![移す前](nephirga/refactor-before/day-orbit.webp) | ![移した後](nephirga/refactor-after/day-orbit.webp) | 0.7 / 0.1% |
| 昼・雷球の予兆 | ![移す前](nephirga/refactor-before/day-orbs.webp) | ![移した後](nephirga/refactor-after/day-orbs.webp) | 3.7 / 3.0% |
| 昼・止まり木 | ![移す前](nephirga/refactor-before/day-perch.webp) | ![移した後](nephirga/refactor-after/day-perch.webp) | 1.1 / 0.0% |
| 昼・部位の破壊 | ![移す前](nephirga/refactor-before/day-break.webp) | ![移した後](nephirga/refactor-after/day-break.webp) | 0.6 / 0.2% |
| 昼・撃破 | ![移す前](nephirga/refactor-before/day-defeat.webp) | ![移した後](nephirga/refactor-after/day-defeat.webp) | 1.1 / 0.6% |
| 嵐・登場 | ![移す前](nephirga/refactor-before/storm-entrance.webp) | ![移した後](nephirga/refactor-after/storm-entrance.webp) | 1.4 / 0.7% |
| 嵐・周回 | ![移す前](nephirga/refactor-before/storm-orbit.webp) | ![移した後](nephirga/refactor-after/storm-orbit.webp) | 2.9 / 2.8% |
| 嵐・雷球の予兆 | ![移す前](nephirga/refactor-before/storm-orbs.webp) | ![移した後](nephirga/refactor-after/storm-orbs.webp) | 8.0 / 10.1% |
| 嵐・止まり木 | ![移す前](nephirga/refactor-before/storm-perch.webp) | ![移した後](nephirga/refactor-after/storm-perch.webp) | 1.9 / 1.2% |
| 嵐・部位の破壊 | ![移す前](nephirga/refactor-before/storm-break.webp) | ![移した後](nephirga/refactor-after/storm-break.webp) | 2.5 / 2.2% |
| 嵐・撃破 | ![移す前](nephirga/refactor-before/storm-defeat.webp) | ![移した後](nephirga/refactor-after/storm-defeat.webp) | 1.0 / 0.5% |

## ネフィルガの見た目の試作（10-7a）

画質「高」・同じ構図（怪獣を決まった位置・状態に置き、決まったカメラで撮る）。左が変更前（9-6a〜10-5b の見た目）、右が変更後。10-7a のときは乱数を決まった種にしていない。

### 昼・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（下から見上げる。演出の場面の中ほどの構図） | ![変更前](nephirga/before/day-entrance.webp) | ![変更後](nephirga/after/day-entrance.webp) |
| 周回（横から） | ![変更前](nephirga/before/day-orbit.webp) | ![変更後](nephirga/after/day-orbit.webp) |
| 雷球の予兆（喉と膜の筋が光る） | ![変更前](nephirga/before/day-orbs.webp) | ![変更後](nephirga/after/day-orbs.webp) |
| 止まり木（翼をたたんで休む） | ![変更前](nephirga/before/day-perch.webp) | ![変更後](nephirga/after/day-perch.webp) |
| 部位の破壊（右翼を壊した直後） | ![変更前](nephirga/before/day-break.webp) | ![変更後](nephirga/after/day-break.webp) |
| 撃破（墜ちていく） | ![変更前](nephirga/before/day-defeat.webp) | ![変更後](nephirga/after/day-defeat.webp) |

### 嵐（昼・雨）

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（下から見上げる。演出の場面の中ほどの構図） | ![変更前](nephirga/before/storm-entrance.webp) | ![変更後](nephirga/after/storm-entrance.webp) |
| 周回（横から） | ![変更前](nephirga/before/storm-orbit.webp) | ![変更後](nephirga/after/storm-orbit.webp) |
| 雷球の予兆（喉と膜の筋が光る） | ![変更前](nephirga/before/storm-orbs.webp) | ![変更後](nephirga/after/storm-orbs.webp) |
| 止まり木（翼をたたんで休む） | ![変更前](nephirga/before/storm-perch.webp) | ![変更後](nephirga/after/storm-perch.webp) |
| 部位の破壊（右翼を壊した直後） | ![変更前](nephirga/before/storm-break.webp) | ![変更後](nephirga/after/storm-break.webp) |
| 撃破（墜ちていく） | ![変更前](nephirga/before/storm-defeat.webp) | ![変更後](nephirga/after/storm-defeat.webp) |

### 重さ（怪獣だけ。怪獣を出して / 隠して描いた差）

場面ごとの値は `nephirga/before-high.json` / `after-high.json` / `before-low.json` / `after-low.json`（嵐の空で測った）。draw call・三角形はシャドウの分を含む（画質「高」はシャドウあり、「低」はなし）。

| | 低 変更前 | 低 変更後 | 高 変更前 | 高 変更後 |
| --- | --- | --- | --- | --- |
| 体の三角形（モデル） | 1,282 | 1,282 | 5,110 | 5,192（角・とげ・爪 +82） |
| 描いた三角形（場面の最小〜最大） | 1,282 | 1,282〜2,290（撃破の破片と煙） | 10,220 | 11,644〜14,796（雨・風の筋・弧・破片・煙） |
| draw call（場面の最小〜最大） | 2 | 2〜4（撃破の破片と煙） | 4 | 5〜10（体 4 + 雨と風 1・弧 1・破片 2・煙 1。出ているときだけ） |
| 作る絵（縮めた絵を含む） | 0 | 0 | 0 | 2.7MB（512 × 512 × 2 枚。「中」は 256 で 0.7MB） |
| 形を動かす時間（JS・中央値） | 0.1ms 未満 | 0.1〜0.2ms | 0.1ms 未満 | 0.2ms |
| 1 フレームの時間（ソフトウェアの描画・目安） | 約 270〜470ms | 約 250〜310ms | 約 1,040〜1,860ms | 約 1,190〜1,840ms |
| 怪獣の分の描く時間（ソフトウェア・目安） | −12〜126ms | −11〜10ms | −33〜58ms | −43〜85ms |

- 描く時間はクラウドのソフトウェアの描画（GPU なし）で、1 フレームに 0.3〜2 秒かかり、ばらつき（± 50ms ほど）が怪獣の分より大きい。前後で目に見える差は無いが、実機の GPU での重さは実機で確かめる（設定の「デバッグ表示」の fps・draw call）
- 起動の量（タイトルまでに読む JS・CSS）: gzip 290.4KB → 290.4KB（変わらない。上限 320KB）。ネフィルガの遅延チャンク `kaiju2-runtime`: JS gzip 10.1KB → 21.1KB・CSS 0.9KB → 1.2KB（ネフィルガを選んだときだけ読む。10-7b で共通の部品を分けて 17.9KB + 共通 5.1KB）
- 絵は起動時（ネフィルガのチャンクを読んだとき）に作る。画質を変えると作り直す（同じ大きさは使い回す）

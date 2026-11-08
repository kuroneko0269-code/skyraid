# 怪獣の見た目の前後（10-7a・10-7b・10-7c・10-7d・10-7e）

撮り方: `node scripts/kaiju-visual-pilot.js <nephirga|albion|gourai|xenolith|vorgas> <before|after> [--measure] [--quality low|medium|high]`（10-7b で怪獣ごとの共通の仕組みにした。`?dev=kshot`・`src/ui/kaiju-shot.ts`。場面は `src/data/<怪獣>-shots.ts`）。見た目だけの乱数（`Math.random`）は決まった種にして撮る。
クラウドには GPU が無く、ソフトウェアの描画で撮った絵（ブルーム・影は本物と同じ式だが、色の細かい違い・ちらつきは実機で確かめる）。

- [ヴォルガス（10-7e）](#ヴォルガス10-7e)
- [UFO ゼノリス（10-7d）](#ufo-ゼノリス10-7d)
- [メカ怪獣ゴウライ（10-7c）](#メカ怪獣ゴウライ10-7c)
- [白鯨アルビオン（10-7b）](#白鯨アルビオン10-7b)
- [ネフィルガ: 共通の部品へ移した前後（10-7b）](#ネフィルガ-共通の部品へ移した前後10-7b)
- [ネフィルガの見た目の試作（10-7a）](#ネフィルガの見た目の試作10-7a)

## ヴォルガス（10-7e）

画質「高」・同じ構図。左が変更前（6-1b の見た目）、右が変更後。推奨案は、6-1 の溶岩の亀裂（形と結びついた「ヴォルガスらしさ」）を位置はそのまま皮膚に合わせ込むこと（溝に沈めてまわりに熱がにじむ・熱線の溜めで尾から頭へ脈打って白熱）と、起動時に作る絵の厚い鱗の板・しわ・爪の古傷・背と尾の骨板・重い足取り（足が着くたびの土煙と揺れ）・上陸の水・溜めの光の粒・撃破で崩れ落ちること。部位の皮膚 5 つと骨板は 1 つのメッシュにまとめた（体の描く回数 6 → 2）。足した骨板は 6-1b の体の面 + 6m の中（体は通り抜けられるまま。頂点ごとにテスト。docs/decisions.md の 10-7e）。
変更前の撮影は 10-7e の撮る仕組みだけを足した 6-1b の見た目（場面の置き方・カメラは同じ）。陸の場面は港の岸壁の上（海から 70m）、登場は湾の沖（岸から約 2km）の海。

### 昼・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（海から上陸する途中。水面の近くから見上げる。演出の場面の後半の構図・水面のしぶきと落ちる水・濡れた皮膚） | ![変更前](vorgas/before/day-entrance.webp) | ![変更後](vorgas/after/day-entrance.webp) |
| 周回（斜め前の上から。鱗の板の皮膚・溝に沈んだ亀裂・背と尾の骨板） | ![変更前](vorgas/before/day-orbit.webp) | ![変更後](vorgas/after/day-orbit.webp) |
| 足元から見上げる（大きさ・目・亀裂・爪） | ![変更前](vorgas/before/day-low.webp) | ![変更後](vorgas/after/day-low.webp) |
| 歩く（足が着いた瞬間を横から。土煙） | ![変更前](vorgas/before/day-walk.webp) | ![変更後](vorgas/after/day-walk.webp) |
| 熱線の溜め（亀裂が尾から頭へ脈打って白熱・結晶が瞬く・光の粒を口へ吸い込む・喉の奥） | ![変更前](vorgas/before/day-charge.webp) | ![変更後](vorgas/after/day-charge.webp) |
| 熱線を撃つ途中（白い芯と青い外側・口の光と湯気） | ![変更前](vorgas/before/day-beam.webp) | ![変更後](vorgas/after/day-beam.webp) |
| 咆哮（頭を上げて口を開ける。足元の砂ぼこりの輪） | ![変更前](vorgas/before/day-roar.webp) | ![変更後](vorgas/after/day-roar.webp) |
| 薙ぎ払いの予兆（尾が上がる。斜め後ろから） | ![変更前](vorgas/before/day-sweep.webp) | ![変更後](vorgas/after/day-sweep.webp) |
| 部位の破壊（結晶を壊した直後。破片） | ![変更前](vorgas/before/day-break.webp) | ![変更後](vorgas/after/day-break.webp) |
| ダウン（左脚を壊して膝をつく。土煙） | ![変更前](vorgas/before/day-down.webp) | ![変更後](vorgas/after/day-down.webp) |
| 撃破（膝から崩れて左へ倒れ込んだ後。土煙・光が消える） | ![変更前](vorgas/before/day-defeat.webp) | ![変更後](vorgas/after/day-defeat.webp) |

### 夕方・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（海から上陸する途中。水面の近くから見上げる。演出の場面の後半の構図・水面のしぶきと落ちる水・濡れた皮膚） | ![変更前](vorgas/before/evening-entrance.webp) | ![変更後](vorgas/after/evening-entrance.webp) |
| 周回（斜め前の上から。鱗の板の皮膚・溝に沈んだ亀裂・背と尾の骨板） | ![変更前](vorgas/before/evening-orbit.webp) | ![変更後](vorgas/after/evening-orbit.webp) |
| 足元から見上げる（大きさ・目・亀裂・爪） | ![変更前](vorgas/before/evening-low.webp) | ![変更後](vorgas/after/evening-low.webp) |
| 歩く（足が着いた瞬間を横から。土煙） | ![変更前](vorgas/before/evening-walk.webp) | ![変更後](vorgas/after/evening-walk.webp) |
| 熱線の溜め（亀裂が尾から頭へ脈打って白熱・結晶が瞬く・光の粒を口へ吸い込む・喉の奥） | ![変更前](vorgas/before/evening-charge.webp) | ![変更後](vorgas/after/evening-charge.webp) |
| 熱線を撃つ途中（白い芯と青い外側・口の光と湯気） | ![変更前](vorgas/before/evening-beam.webp) | ![変更後](vorgas/after/evening-beam.webp) |
| 咆哮（頭を上げて口を開ける。足元の砂ぼこりの輪） | ![変更前](vorgas/before/evening-roar.webp) | ![変更後](vorgas/after/evening-roar.webp) |
| 薙ぎ払いの予兆（尾が上がる。斜め後ろから） | ![変更前](vorgas/before/evening-sweep.webp) | ![変更後](vorgas/after/evening-sweep.webp) |
| 部位の破壊（結晶を壊した直後。破片） | ![変更前](vorgas/before/evening-break.webp) | ![変更後](vorgas/after/evening-break.webp) |
| ダウン（左脚を壊して膝をつく。土煙） | ![変更前](vorgas/before/evening-down.webp) | ![変更後](vorgas/after/evening-down.webp) |
| 撃破（膝から崩れて左へ倒れ込んだ後。土煙・光が消える） | ![変更前](vorgas/before/evening-defeat.webp) | ![変更後](vorgas/after/evening-defeat.webp) |

### 重さ（怪獣だけ。怪獣を出して / 隠して描いた差）

場面ごとの値は `vorgas/before-<画質>.json` / `after-<画質>.json`（夕方の空・周回 / 熱線 / 撃破の 3 場面で測った。クラウドの描画が遅いので 3 場面にした）。draw call・三角形はシャドウの分を含む（「中」「高」はシャドウあり、「低」はなし）。

| | 低 変更前 | 低 変更後 | 中 変更前 | 中 変更後 | 高 変更前 | 高 変更後 |
| --- | --- | --- | --- | --- | --- | --- |
| 体の三角形（モデル） | 3,934 | 3,934（変わらない） | 18,532 | 18,702（骨板 +170） | 18,532 | 18,702（+170） |
| 描いた三角形（3 場面の最小〜最大） | 3,934〜3,958 | 3,934〜4,214 | 36,290〜36,314 | 36,634〜37,094 | 36,290〜36,314 | 36,638〜37,362 |
| draw call（3 場面の最小〜最大） | 6〜7 | 2〜5 | 11〜12 | 5〜8 | 11〜12 | 5〜8 |
| 作る絵（縮めた絵を含む） | 0 | 0 | 0 | 0.35MB（256 × 1 枚） | 0 | 1.4MB（512 × 1 枚） |
| 形を動かす時間（JS・中央値） | 0.1ms | 0.2ms | 0.1ms | 0.2ms | 0.1ms | 0.2ms |
| 描く時間の差（ソフトウェアの描画・目安） | 約 59〜76ms | 約 23〜33ms | 約 92〜219ms | 約 32〜142ms | 約 15〜347ms | 約 76〜205ms |

- draw call の内訳（「高」）: 体 2（部位をまとめた皮膚 + 結晶）+ シャドウ 1（皮膚。変更前は部位 5）+ 熱線 0〜1 + 岩 0〜1（+ シャドウ）+ 柔らかい粒（土煙・水・湯気）0〜1 + 光る粒（火の粉・溜めの粒）0〜1 + 破片と煙 0〜2（出ているときだけ）。変更前は体 6 + シャドウ 5 + 熱線・岩。「低」はシャドウなしで体 2 + 粒（出たときだけ）
- 描く時間はクラウドのソフトウェアの描画（GPU なし）で、ほかの撮影・テストと同時に動かしたのでばらつきが大きい。実機の GPU での重さは実機で確かめる（設定の「デバッグ表示」の fps・draw call）
- 起動の量（タイトルまでに読む JS・CSS。`scripts/startup-breakdown.js`）: gzip 288.2KB → 288.2KB（変わらない。上限 320KB。入口 `vorgas-link.ts` は flight-runtime の中で小さい）。遅延チャンク: 怪獣のモデル `kaiju-object` JS gzip 7.4KB → 13.8KB、新しく演出 `vorgas-runtime` 1.7KB（どちらもモード選択を開いたときに先に読む）
- 「中」「高」は 6-1b の式の鱗（画素ごとに 27 個の点を探す）を絵に置き換えたので、皮膚の画素の計算はむしろ軽い

## UFO ゼノリス（10-7d）

画質「高」・同じ構図。左が変更前（10-5a〜10-5b の見た目）、右が変更後。要望「ただの UFO に見えるので、もっとキラキラ・近未来に」への推奨案は、銀の面を空・水平線・海・日が映り込む鏡の金属にし（式で映す。絵は作らない）、見る角度で色が変わる虹色の板・継ぎ目を走る光の筋・上下に浮かんで回る光の輪・ドームのまわりの結晶・ガラスの奥の光る核・六角のホログラムのバリア・光の尾 / 波 / きらめく粒を重ねること。足した形は体の当たり（円盤の楕円体とドーム）+ 衝突の余裕（6m）の中（頂点ごとにテスト。当たりは変えていない。docs/decisions.md の 10-7d）。
速くて小さいので見失わないよう、遠くでは光る星の目印が付く（光線の予兆の線より暗い）。変更前の撮影は 10-7d の撮る仕組みだけを足した 10-5b の見た目（場面の置き方・カメラは同じ）。

### 昼・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（空から光の柱の中を降りてくる途中。下から見上げる。演出の場面の中ほどの構図） | ![変更前](xenolith/before/day-entrance.webp) | ![変更後](xenolith/after/day-entrance.webp) |
| 周回（斜め前の上から。鏡の金属・虹色の板・浮かぶ光の輪・結晶・六角のバリア） | ![変更前](xenolith/before/day-orbit.webp) | ![変更後](xenolith/after/day-orbit.webp) |
| 下から（砲口・発生器・下の面の回る光の模様・下の光の輪） | ![変更前](xenolith/before/day-under.webp) | ![変更後](xenolith/after/day-under.webp) |
| 急加速（横へ 320 m/s。光の尾ときらめく粒） | ![変更前](xenolith/before/day-dash.webp) | ![変更後](xenolith/after/day-dash.webp) |
| バリア（殻に当たった波紋が六角を光らせる） | ![変更前](xenolith/before/day-barrier.webp) | ![変更後](xenolith/after/day-barrier.webp) |
| 瞬間移動の予兆（移る先の光の柱と輪。本体は光がほどけ始める） | ![変更前](xenolith/before/day-warp.webp) | ![変更後](xenolith/after/day-warp.webp) |
| なぎ払う光線（撃つ途中。白い芯と外側の光） | ![変更前](xenolith/before/day-sweep.webp) | ![変更後](xenolith/after/day-sweep.webp) |
| 溜め撃ちの溜め（止まった線 = 避けどき。流れる点線） | ![変更前](xenolith/before/day-charged.webp) | ![変更後](xenolith/after/day-charged.webp) |
| 光の弾のばらまき（予兆の縁の光と、撃ったばかりの弾のきらめき） | ![変更前](xenolith/before/day-orbs.webp) | ![変更後](xenolith/after/day-orbs.webp) |
| 部位の破壊（縁の発光体を壊した直後。破片と電気の弧） | ![変更前](xenolith/before/day-break.webp) | ![変更後](xenolith/after/day-break.webp) |
| 撃破（光が消え、電気の弧と煙を引いて落ちる） | ![変更前](xenolith/before/day-defeat.webp) | ![変更後](xenolith/after/day-defeat.webp) |

### 夕方・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（空から光の柱の中を降りてくる途中。下から見上げる。演出の場面の中ほどの構図） | ![変更前](xenolith/before/evening-entrance.webp) | ![変更後](xenolith/after/evening-entrance.webp) |
| 周回（斜め前の上から。鏡の金属・虹色の板・浮かぶ光の輪・結晶・六角のバリア） | ![変更前](xenolith/before/evening-orbit.webp) | ![変更後](xenolith/after/evening-orbit.webp) |
| 下から（砲口・発生器・下の面の回る光の模様・下の光の輪） | ![変更前](xenolith/before/evening-under.webp) | ![変更後](xenolith/after/evening-under.webp) |
| 急加速（横へ 320 m/s。光の尾ときらめく粒） | ![変更前](xenolith/before/evening-dash.webp) | ![変更後](xenolith/after/evening-dash.webp) |
| バリア（殻に当たった波紋が六角を光らせる） | ![変更前](xenolith/before/evening-barrier.webp) | ![変更後](xenolith/after/evening-barrier.webp) |
| 瞬間移動の予兆（移る先の光の柱と輪。本体は光がほどけ始める） | ![変更前](xenolith/before/evening-warp.webp) | ![変更後](xenolith/after/evening-warp.webp) |
| なぎ払う光線（撃つ途中。白い芯と外側の光） | ![変更前](xenolith/before/evening-sweep.webp) | ![変更後](xenolith/after/evening-sweep.webp) |
| 溜め撃ちの溜め（止まった線 = 避けどき。流れる点線） | ![変更前](xenolith/before/evening-charged.webp) | ![変更後](xenolith/after/evening-charged.webp) |
| 光の弾のばらまき（予兆の縁の光と、撃ったばかりの弾のきらめき） | ![変更前](xenolith/before/evening-orbs.webp) | ![変更後](xenolith/after/evening-orbs.webp) |
| 部位の破壊（縁の発光体を壊した直後。破片と電気の弧） | ![変更前](xenolith/before/evening-break.webp) | ![変更後](xenolith/after/evening-break.webp) |
| 撃破（光が消え、電気の弧と煙を引いて落ちる） | ![変更前](xenolith/before/evening-defeat.webp) | ![変更後](xenolith/after/evening-defeat.webp) |

### 重さ（怪獣だけ。怪獣を出して / 隠して描いた差）

場面ごとの値は `xenolith/before-<画質>.json` / `after-<画質>.json`（夕方の空・撮影の 11 場面で測った）。draw call・三角形はシャドウの分を含む（「中」「高」はシャドウあり、「低」はなし）。

| | 低 変更前 | 低 変更後 | 中 変更前 | 中 変更後 | 高 変更前 | 高 変更後 |
| --- | --- | --- | --- | --- | --- | --- |
| 体の三角形（モデル） | 664 | 952（結晶・光の輪 +288） | 1,920 | 2,528（+608） | 1,920 | 2,528（+608） |
| 描いた三角形（場面の最小〜最大） | 664〜1,880 | 984〜2,582 | 3,840〜5,056 | 5,124〜6,858 | 3,840〜5,056 | 5,134〜6,922 |
| draw call（場面の最小〜最大） | 1〜6 | 2〜6 | 2〜7 | 6〜12 | 2〜7 | 6〜12 |
| 作る絵（縮めた絵を含む） | 0 | 0 | 0 | 0 | 0 | 0（式だけ） |
| 形を動かす時間（JS・中央値） | 0.1ms 以下 | 0.1ms | 0.1ms 以下 | 0.1〜0.2ms | 0.1ms 以下 | 0.1ms |
| 1 フレームの時間（ソフトウェアの描画・目安） | 約 203〜608ms | 約 399〜572ms | 約 1,434〜3,234ms | 約 1,392〜2,375ms | 約 1,053〜4,317ms | 約 1,302〜3,250ms |

- draw call の内訳（「高」）: 体 1 + シャドウ 1 + 六角のバリア 0〜1 + 光線 0〜1 + 柱と輪 0〜2 + 光の弾 0〜1（10-5b まで）+ 光る星（きらめく粒・弾のきらめき・目印）1 + 光の波 0〜1 + 光の尾 0〜1 + 電気の弧 0〜1 + 破片と煙 0〜2 + 影 1（出ているときだけ）。「低」は体 1 + 殻・光線・柱 + 星 0〜1 + 波・破片（出たときだけ。尾・弧・影・虹色・筋・六角は無し）
- 描く時間はクラウドのソフトウェアの描画（GPU なし）で、ほかの撮影と同時に動かしたのでばらつきが大きい（変更前の方が遅い場面があるのはばらつき）。実機の GPU での重さは実機で確かめる（設定の「デバッグ表示」の fps・draw call）
- 起動の量（タイトルまでに読む JS・CSS。`scripts/startup-breakdown.js`）: gzip 288.2KB → 288.2KB（変わらない。上限 320KB）。ゼノリスの遅延チャンク `xenolith-runtime`: JS gzip 23.1KB → 35.4KB（ゼノリスを選んだときだけ読む）
- 絵は作らない（鏡の映り込み・虹色・光の筋・六角はシェーダーの式）。画質を変えるとマテリアルと粒を作り直す

## メカ怪獣ゴウライ（10-7c）

画質「高」・同じ構図。左が変更前（10-4a〜10-4c の見た目）、右が変更後。要望「ただの建物に見えるので、もう少し怪獣らしく」への推奨案は、前の装甲の楔（正面の面積の大半）を光る大きな目・熾火の口・牙の「顔」にし（放熱で板が開くと大あごの内側の牙と喉の核）、頭とあご・腕と爪・背の放熱板・背のとげ・尾・甲羅の形のハッチを足すこと。足した形は体の当たりの箱 + 衝突の余裕（6m）の中（動かしても。頂点ごとにテスト）で、当たりは変えていない（docs/decisions.md の 10-7c）。
登場の場面は撮る仕組みで「半分浮かび上がって目が灯った瞬間」に止めて撮った。変更前の撮影は 10-7c の撮る仕組みだけを足した 10-4c の見た目（場面の置き方・カメラは同じ）。

### 昼・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（湾から浮かび上がり、目が灯る瞬間。水面の近くから見上げる。演出の場面の中ほどの構図） | ![変更前](gourai/before/day-entrance.webp) | ![変更後](gourai/after/day-entrance.webp) |
| 周回（斜め前の上から。全体の形・顔・腕・海面の吹きおろし） | ![変更前](gourai/before/day-orbit.webp) | ![変更後](gourai/after/day-orbit.webp) |
| 正面（少し下から。前の装甲の顔・頭・牙） | ![変更前](gourai/before/day-front.webp) | ![変更後](gourai/after/day-front.webp) |
| 後ろ（斜め後ろの上から。排気口の熱のゆらぎ・尾・背の放熱板） | ![変更前](gourai/before/day-rear.webp) | ![変更後](gourai/after/day-rear.webp) |
| 一斉発射の予兆（ハッチが開いて赤く点滅。腕を構えて爪を鳴らし、目が赤い） | ![変更前](gourai/before/day-volley.webp) | ![変更後](gourai/after/day-volley.webp) |
| 回転掃射の予兆（機銃が赤く光り、危ない高さの輪。腕を構える） | ![変更前](gourai/before/day-sweep.webp) | ![変更後](gourai/after/day-sweep.webp) |
| 放熱（大あごが開いて牙と喉の核。背の板が開いて蒸気、継ぎ目から熱の光） | ![変更前](gourai/before/day-vent.webp) | ![変更後](gourai/after/day-vent.webp) |
| 装甲を捨てる（板が外・上へ飛ぶ途中。爆発と煙） | ![変更前](gourai/before/day-purge.webp) | ![変更後](gourai/after/day-purge.webp) |
| 部位の破壊（右の肩の機銃を壊した直後。爆発・火花・破片） | ![変更前](gourai/before/day-break.webp) | ![変更後](gourai/after/day-break.webp) |
| 撃破（傾きながら海へ。爆発が連鎖する） | ![変更前](gourai/before/day-defeat.webp) | ![変更後](gourai/after/day-defeat.webp) |

### 夕方・快晴

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| 登場（湾から浮かび上がり、目が灯る瞬間。水面の近くから見上げる。演出の場面の中ほどの構図） | ![変更前](gourai/before/evening-entrance.webp) | ![変更後](gourai/after/evening-entrance.webp) |
| 周回（斜め前の上から。全体の形・顔・腕・海面の吹きおろし） | ![変更前](gourai/before/evening-orbit.webp) | ![変更後](gourai/after/evening-orbit.webp) |
| 正面（少し下から。前の装甲の顔・頭・牙） | ![変更前](gourai/before/evening-front.webp) | ![変更後](gourai/after/evening-front.webp) |
| 後ろ（斜め後ろの上から。排気口の熱のゆらぎ・尾・背の放熱板） | ![変更前](gourai/before/evening-rear.webp) | ![変更後](gourai/after/evening-rear.webp) |
| 一斉発射の予兆（ハッチが開いて赤く点滅。腕を構えて爪を鳴らし、目が赤い） | ![変更前](gourai/before/evening-volley.webp) | ![変更後](gourai/after/evening-volley.webp) |
| 回転掃射の予兆（機銃が赤く光り、危ない高さの輪。腕を構える） | ![変更前](gourai/before/evening-sweep.webp) | ![変更後](gourai/after/evening-sweep.webp) |
| 放熱（大あごが開いて牙と喉の核。背の板が開いて蒸気、継ぎ目から熱の光） | ![変更前](gourai/before/evening-vent.webp) | ![変更後](gourai/after/evening-vent.webp) |
| 装甲を捨てる（板が外・上へ飛ぶ途中。爆発と煙） | ![変更前](gourai/before/evening-purge.webp) | ![変更後](gourai/after/evening-purge.webp) |
| 部位の破壊（右の肩の機銃を壊した直後。爆発・火花・破片） | ![変更前](gourai/before/evening-break.webp) | ![変更後](gourai/after/evening-break.webp) |
| 撃破（傾きながら海へ。爆発が連鎖する） | ![変更前](gourai/before/evening-defeat.webp) | ![変更後](gourai/after/evening-defeat.webp) |

### 重さ（怪獣だけ。怪獣を出して / 隠して描いた差）

場面ごとの値は `gourai/before-<画質>.json` / `after-<画質>.json`（夕方の空・撮影の 10 場面で測った）。draw call・三角形はシャドウの分を含む（「中」「高」はシャドウあり、「低」はなし）。

| | 低 変更前 | 低 変更後 | 中 変更前 | 中 変更後 | 高 変更前 | 高 変更後 |
| --- | --- | --- | --- | --- | --- | --- |
| 体の三角形（モデル） | 600 | 1,264（顔・頭・腕・板・尾 +664） | 1,208 | 2,504（+1,296） | 1,208 | 2,504（+1,296） |
| 描いた三角形（場面の最小〜最大） | 600〜984 | 1,264〜1,648 | 2,416〜2,800 | 5,344〜5,932 | 2,416〜2,800 | 5,368〜6,024 |
| draw call（場面の最小〜最大） | 1〜3 | 1〜6（爆発・蒸気・水は出たときだけ） | 2〜4 | 8〜11 | 2〜4 | 8〜11 |
| 作る絵（縮めた絵を含む） | 0 | 0 | 0 | 0.35MB（256 × 256 × 1 枚） | 0 | 1.4MB（512 × 512 × 1 枚） |
| 形を動かす時間（JS・中央値） | 0.1ms 未満 | 0.1〜0.2ms | 0.1ms 未満 | 0.1〜0.3ms | 0.1ms 未満 | 0.1〜0.2ms |
| 1 フレームの時間（ソフトウェアの描画・目安） | 約 214〜320ms | 約 239〜273ms | 約 1,085〜2,180ms | 約 1,117〜1,284ms | 約 1,327〜2,798ms | 約 1,461〜1,584ms |

- draw call の内訳（「高」）: 体 1 + シャドウ 1 + 弾 0〜2・回転掃射の輪 0〜1（10-4a のまま）+ 柔らかい粒（蒸気・煙・水）1 + 光る粒（炎・熱のゆらぎ）1 + 影 1 + 雨と火花の筋 0〜1 + 破片と煙 0〜2（出ているときだけ）。海面の映り込みの分も数に入る。「低」は体 1 + 攻撃 + 粒・破片（出たときだけ。熱のゆらぎ・海面の吹きおろし・筋・影は無し）
- 描く時間はクラウドのソフトウェアの描画（GPU なし）で、ほかの撮影・テストと同時に動かしたのでばらつきが大きい（変更前の方が遅い場面があるのはばらつき）。実機の GPU での重さは実機で確かめる（設定の「デバッグ表示」の fps・draw call）
- 起動の量（タイトルまでに読む JS・CSS）: gzip 290.4KB → 290.4KB（変わらない。上限 320KB）。ゴウライの遅延チャンク `gourai-runtime`: JS gzip 21.3KB → 33.4KB（ゴウライを選んだときだけ読む）。共通の部品のチャンク（シェーダーの部品・登場の場面 5.1KB・影 1.9KB）もゴウライを選んだときに読む（ネフィルガ・アルビオンと共有）
- 絵は起動時（ゴウライのチャンクを読んだとき）に作る。画質を変えると作り直す（同じ大きさは使い回す）

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

# SkyRaid — 開発計画

各項目は「1クラウドセッション＝1タスク」の粒度。上から順に進める。
終わったら `[x]` にして、PRのリンクを書く。

## フェーズ0: 土台

- [x] 0-1 Vite + TypeScript + Three.js の雛形。`npm run dev/build/check/test` が通る。空のシーン（空の色と地面の板）を表示 — main マージ（PR #1）: https://github.com/kuroneko0269-code/skyraid/commit/0653e0a9e6819f9136d3122b22a7629bd5c5aaec
- [x] 0-2 ESLint / Prettier / Vitest 設定。`core/loop.ts`（固定タイムステップ）と `core/input.ts`（キーボード抽象化） — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/8cb36b11ba41a2149a3e65ae61a3dec4415ab192
- [x] 0-3 品質設定（低/中/高）とデバッグ表示（fps, draw calls）。スマホ判定で「低」を初期値に — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/346b62eb8b0b53e71f5af7b67c2fa36528e56e07

## フェーズ1: 飛行

- [x] 1-1 飛行モデル `flight/`。プレースホルダー機体（Cone + Box）で飛べる。失速・地面衝突 — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/400ab418c802401553cbc0640d13780a2f4793c4
- [x] 1-2 追従カメラ。速度で画角と距離が変化 — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/e7b97c60f693818480880e00c978a28e03b1331a
- [x] 1-3 地形（ハイトマップの島）と海面、スカイボックス、太陽光 — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/697c233042379be8b5c1adb345e9e8b2e3e0ca69
- [x] 1-4 HUD（速度・高度・姿勢） — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/930f9d4b7eafab5295860e153e77216e3fc5cc32（事前修正: 画質「低」の海面の簡略化 https://github.com/kuroneko0269-code/skyraid/commit/7ce8767bf82f14cecd2d8cd7fdcdd4c27350a66a）
- [x] 1-5 タッチ操作とゲームパッド対応（スマホ優先のため 1-3・1-4 より前倒し） — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/2c9d0345b7d6c600a1311dec6ffc0e674ade5cf9
- [x] 1-6 フリーフライトモードとタイトル画面 — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/d01967ed712555b0042781bd0176190f5a995ab7
- [x] 1-7 操作感調整（人間がプレビューで試して数値を決める） — 実機評価で問題なしのため完了扱い（数値の変更なし）

## フェーズ2: 戦闘

- [x] 2-1 機銃とヒット判定、ダメージ、撃墜演出（プリミティブ） — main 直接マージ: https://github.com/kuroneko0269-code/skyraid/commit/ccd4e1312d419074176d549eb9a10031b6793efb
- [x] 2-2 ロックオンとミサイル、フレア — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/dd55dfaf45e0e1483b803832396f7cab51ec6482
- [x] 2-3 敵機AI（巡航→追尾→攻撃→回避） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/58d80df53a29bc07b93d089c0ee707d9823c3514（事前修正: decisions.md に 2-2 の本来のコミットメッセージを追記 https://github.com/kuroneko0269-code/skyraid/commit/c53a2f2a36fd788e52f80d3d441818cce314decf）
- [x] 2-4 ミッション定義とランナー。目標・成功失敗判定・リザルト画面 — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/1af38e806a65c137e86721f82e364475dd3f551c
- [x] 2-5 初期ミッション 5 本のデータ（M1〜M5。輸送機・怪獣の仮実装・地上目標の仮置き、護衛・破壊・怪獣の目標、ミッションの解放） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/46e572d（事前修正: タイトルのデモカメラを下げて山を画面の下半分に https://github.com/kuroneko0269-code/skyraid/commit/9637dd0）
- [x] 2-6 地上目標と無誘導兵器（レーダー・燃料タンク・格納庫・対空砲、ロケット・爆弾と着弾予測点、M4 の本実装） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/9784aee（事前修正: M2 の第 1 波を 1 機ずつ 20 秒差に https://github.com/kuroneko0269-code/skyraid/commit/de86fd8）

## フェーズ3: 成長

- [x] 3-1 セーブ（localStorage、バージョン付きスキーマ） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/be76973（事前修正: 遠くの海面に少し上の空を映す https://github.com/kuroneko0269-code/skyraid/commit/5167817・M2 のブリーフィング文 https://github.com/kuroneko0269-code/skyraid/commit/d0fa4a1）
- [x] 3-2 クレジットとリザルト評価（S〜C） — 3-1 と同じコミット: https://github.com/kuroneko0269-code/skyraid/commit/be76973
- [x] 3-3 ハンガー画面：機体選択と4系統の強化 — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/e2683ce
- [x] 3-4 機体 4 種のデータとパラメータ差 — 3-3 と同じコミット: https://github.com/kuroneko0269-code/skyraid/commit/e2683ce

## フェーズ4: 見栄え

- [x] 4-1 PBR + 物理ベースの空（大気散乱。HDR 画像は使わない）+ ブルーム（フェーズ2 の途中で前倒し） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/4daf5f2e2495c9e1c5133915b4099da43f3d22ac（事前修正: 画質の自動判定・自動ダウングレード・MISSILE 警告の位置 https://github.com/kuroneko0269-code/skyraid/commit/7b6aa009911a000a97ccabe94963aee4057ce300）
- [x] 4-2 水面シェーダーと雲 — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/dd3d06d1406c2a3084b30cf3bf2d02abb284a509（事前修正: 正式名称を SkyRaid: Titan Skies に変更 https://github.com/kuroneko0269-code/skyraid/commit/c17a0601865d1f33d98cb1c24cf5592770e823c4）
- [x] 4-2b 4-2 の実機確認の修正（雲がカメラと一緒に傾く・高高度で白く霞む・海の照り返しが白いノイズ） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/0c490abe416af8fed73241383aa78900e1f63e44
- [x] 4-2c 実機確認の修正（敵 OFF なのに敵機が出る・島の海岸線がちらつく） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/87faca56f0c5358f20ceac65d482bdc2e743a088
- [x] 4-6 地形の写実化（生成時の水力浸食、傾斜と高さによる質感の層、木、風上は崖・風下は砂浜。方向性は「写真のような写実」） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/879b922（事前修正: 墜落後の復帰位置をフリーフライトとミッションで分ける https://github.com/kuroneko0269-code/skyraid/commit/60bd7e9）
- [x] 4-7 地形の見た目の仕上げ（実機の画質「中」のスクリーンショット評価で判明した 5 点: 地形の面の粗さ・色の均一さ・雪・木の密度・地平線の霞） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/a886d46（事前修正: M2 の最初の 1 機を easy に https://github.com/kuroneko0269-code/skyraid/commit/e72f9c2・パッドの爆弾を Y 長押しに https://github.com/kuroneko0269-code/skyraid/commit/74fd877）
- [x] 4-8 地形の残課題（画質「中」以上の山腹の階段状の縞・砂浜の面積・近景の木の色の個体差） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/5ac763a
- [x] 4-3 機体モデル差し替え（CC0素材 or 自作）。Draco圧縮 → 手続き生成の自作モデル（4 機種・敵機・輸送機、操舵面・炎・飛行機雲、外部アセットなし） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/f2c3c91（事前修正: 300 行を超えた 3 ファイルの分割 https://github.com/kuroneko0269-code/skyraid/commit/87835b2）
- [x] 4-10 UI 刷新・ブランド素材の受け口・セキュリティヘッダー・PWA（デザインシステム、タイトルのロゴと展開アニメ、アイコン・favicon、`_headers` の CSP、innerHTML の点検、manifest と Service Worker、safe-area と iOS の「ホーム画面に追加」案内） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/07deb07（事前修正: 機体の環境マップ https://github.com/kuroneko0269-code/skyraid/commit/a2090e5・plan.md の並べ替え https://github.com/kuroneko0269-code/skyraid/commit/3a0f536）
- [x] 4-4 エフェクト（排気、ミサイル煙、爆発）と音（Web Audio の合成・BGM の受け口・音量の設定） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/c340ea1（事前修正: ランク S を金色に https://github.com/kuroneko0269-code/skyraid/commit/54eaa50・アイコンの生成とロゴの表示サイズ https://github.com/kuroneko0269-code/skyraid/commit/e10ce5b）
- [x] 4-9 低地の色と木（乾いた草の割合と色・中間スケールのむら・低地の湿地・草の生えた砂の帯、葉の明度と空の環境マップ・ビルボードの法線、近景の円錐 3 段 + 丸めた頂点、遠景の手続きの樹冠テクスチャ、森の縁の高さと疎密、「高」の樹冠の影） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/b56d43d
- [ ] 4-11 操作設定とチュートリアル
- [ ] 4-5 コックピット視点

## フェーズ5: PvP

- [ ] 5-1 `net/` 基盤：PeerJS 接続、部屋コード、ホスト/クライアント役割
- [ ] 5-2 状態同期と補間。2人で同じ空を飛べる
- [ ] 5-3 ホスト側ヒット判定、撃墜、リスポーン
- [ ] 5-4 ロビーUI、4人対応、勝敗判定

## フェーズ6: レイド

- [ ] 6-1 怪獣モデル（プレースホルダー）と部位HP
- [ ] 6-2 怪獣AI：移動、4種の攻撃、予兆表示
- [ ] 6-3 フェーズ制（70% / 40%）とブレイク
- [ ] 6-4 市街地マップと破壊される建物
- [ ] 6-5 ミッション5（怪獣導入）とレイドモード入口（M5 のデータと怪獣の仮実装は 2-5 で入れた。6-1 の怪獣に差し替える）
- [ ] 6-6 協力時の同期（怪獣状態はホストが配信）

## フェーズ7: 追加コンテンツ

- [ ] 7-5 天候・時間帯
- [ ] 7-1 リングレース
- [ ] 7-2 防衛戦
- [ ] 7-3 スキン・デカール
- [ ] 7-4 Supabase ランキング（匿名ログイン）
- [ ] 7-6 実績・デイリーミッション
- [ ] 7-7 フォトモード
- [ ] 7-8 リプレイ

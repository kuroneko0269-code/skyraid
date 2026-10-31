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
- [x] 4-12 操作補助・難易度・音の改善（実機のスマホの評価「敵が強すぎて撃墜できない」「操作が難しく敵を捉えられない」: エイムアシスト・ターゲットカメラ・機銃の判定 1.3 倍・HUD の角度差の矢印と接近 / 離脱の色・レーダー 1.3 倍と高度差・BEHIND、フリーフライトの初期値 easy・easy を緩める・rookie（M1）・機銃 12、命中音・発射音の低域・ミサイル発射 3 層・撃墜の音） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/e11d1a0
- [x] 4-12b 実機確認の修正（機銃の命中音がまだ軽い・被弾音 (b) を別の音に・撃墜後の再開で機体の表示がずれる・機体の影が点線の輪郭になる） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/65412f5
- [x] 4-11 操作設定とチュートリアル（感度・デッドゾーン・反転・オートレベル・左右入替・振動・ボタンの大きさ・キー割当（セーブ v5）、5 段階のチュートリアル（練習・初回 500 CR）、タッチ操作のヒント） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/6608da6（事前修正: M2 の 2 機目を easy に https://github.com/kuroneko0269-code/skyraid/commit/4080fa1・難易度を一度だけ easy に https://github.com/kuroneko0269-code/skyraid/commit/f5f6236・main.ts の分割 https://github.com/kuroneko0269-code/skyraid/commit/b2a290a・効果音のリミッター https://github.com/kuroneko0269-code/skyraid/commit/c37f61c）
- [ ] 4-5 コックピット視点

## フェーズ5: PvP

- [x] 5-1 `net/` 基盤：PeerJS 接続、部屋コード、ホスト/クライアント役割（指示により 5-2 の状態同期と補間・5-4 の最小限のロビーと 4 人対応も含む。「同じ空を飛ぶ」まで） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/1ddd92f
- [x] 5-2 状態同期と補間。2人で同じ空を飛べる — 5-1 と同じコミットで実装済み（実機 2 台で確認済み）: https://github.com/kuroneko0269-code/skyraid/commit/1ddd92f
- [x] 5-3 ホスト側ヒット判定、撃墜、リスポーン（指示により 5-4 の勝敗判定・ロビーのルール設定・リザルトも含む） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/2fb5eb9（事前修正: 飛行中メニューの「退出する」 https://github.com/kuroneko0269-code/skyraid/commit/f51bb00・墜落後のカメラ https://github.com/kuroneko0269-code/skyraid/commit/9c7a9fa）
- [x] 5-4 ロビーUI、4人対応、勝敗判定（Ready・ハンガー・共有 / コピー / QR・定型文、チーム戦（2 対 2）・初心者保護、カウントダウン・残り時間の警告・撃墜の画面・無敵の表示、リザルトのベストプレイヤー・最長連続撃墜・「もう一度」の待ち、クライアントの 10 秒以内の再接続） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/d1bc0e2（事前修正: 開始位置を高度 800m・海側・間隔 150m に https://github.com/kuroneko0269-code/skyraid/commit/882ba22）

## フェーズ6: レイド

- [x] 6-1 怪獣モデル（プレースホルダー）と部位HP（指示により手続き生成の本モデル「ヴォルガス」・6-2 と同時） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/52b5d84
- [x] 6-2 怪獣AI：移動、4種の攻撃、予兆表示（指示により HUD・音・ボットでの HP の決定も） — 6-1 と同じコミット: https://github.com/kuroneko0269-code/skyraid/commit/52b5d84
- [ ] 6-3 フェーズ制（70% / 40%）とブレイク（6-1 / 6-2 で前倒し実装済み: https://github.com/kuroneko0269-code/skyraid/commit/52b5d84。最終フェーズは 4.5 分）
- [x] 6-4 市街地マップと破壊される建物（港湾都市・マップの選択・建物の衝突と破壊・守れた建物・レイドを港湾都市に固定） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/39ddb13（事前修正 6-1b: 怪獣の結晶の塊・鱗と筋肉・目・前腕、ソロの倍率 ×3.8 https://github.com/kuroneko0269-code/skyraid/commit/3cff5dd）
- [ ] 6-5 ミッション5（怪獣導入）とレイドモード入口（M5 のデータと怪獣の仮実装は 2-5 で入れた。6-1 の怪獣に差し替える）（6-1 / 6-2 で M5 の差し替え・ソロのレイド・協力の最小限の入口を前倒し実装済み: https://github.com/kuroneko0269-code/skyraid/commit/52b5d84）
- [x] 6-6 協力時の同期（怪獣状態はホストが配信）（6-2 で最小限: ホストが怪獣を動かし state に部位 HP・状態・位置を追加。指示により協力レイドの仕上げ: 建物の破壊の同期・復帰 5 秒・役割分担の HUD・協力のリザルト・報酬の式・難易度・ブリーフィング・state 40 バイト以下） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/f938200

## フェーズ7: 追加コンテンツ

- [x] 7-5 天候・時間帯（プリセット 8 種・3 秒の補間・フリーフライトの時間の進行・月と星・夜の固定露出・雨の粒と海の波紋・風・HUD のマーカーの視認性と夜の減光・環境音、PvP / 協力はロビーのホスト設定） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/f6bc87d
- [ ] 7-1 リングレース
- [ ] 7-2 防衛戦
- [ ] 7-3 スキン・デカール
- [ ] 7-4 Supabase ランキング（匿名ログイン）
- [ ] 7-6 実績・デイリーミッション
- [x] 7-7 フォトモード（→ 7-A で実施）
- [x] 7-A フォトモード（ポーズメニュー / P、機体中心の自由カメラ・プリセット 6 種・画角 / ロール / フォーカス、画面の調整、表示の切替とコマ送り、天候・時刻の上書き、PNG 保存（画面 / 2 倍 / 4K・透かし・共有）、事前修正: 霧のスケールハイト 600m・main.ts の分割） — main マージ: https://github.com/kuroneko0269-code/skyraid/commit/3df498e（事前修正: 霧 https://github.com/kuroneko0269-code/skyraid/commit/77fe9d4・main.ts の分割 https://github.com/kuroneko0269-code/skyraid/commit/29c866b）
- [x] 7-5b 実機の修正: タイトル等に HUD が出る不具合（夜の減光のインライン opacity が隠す CSS に勝っていた → data-hud と CSS 変数）、夕焼けの強化（夕方 12 → 5°・早朝 8 → 6°、低い太陽の大気散乱（Rayleigh・オゾン・散乱の高さ・Mie の光芒）、雲の下面の照り返し、夕方 −0.3EV） — main マージ: https://github.com/kuroneko0269-code/skyraid/commit/44e784d（HUD の修正: https://github.com/kuroneko0269-code/skyraid/commit/c612c4d）
- [ ] 7-8 リプレイ

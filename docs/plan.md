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
- [x] 7-1 リングレース（コース 4 本（海岸周回・渓谷スラローム・港湾ハイスピード・夕空アクロバット）と保証条件のテスト、リングの種類 4 種・未通過 +5 秒、カウントダウン → 走行 → ゴール → リザルト、ゴースト 15Hz、HUD、ランクと報酬、ベスト 5 と装備のハッシュ（セーブ v6）、コース一覧と機体選択、音、ボットで 4 コース完走・ゴールドタイムの決定。ソロのみ） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/184940c
- [x] 7-2 防衛戦（ソロ / 協力 2〜4 人、島と港湾都市、基地（司令部・レーダー・燃料タンク・味方の対空砲 2 基）、全 10 波（データ駆動）・戦闘機 / 爆撃機 / 巡航ミサイル、人数と難易度のスケール、予告、補給、HUD・音・リザルト・報酬、協力の同期（state に基地と戦闘機、爆撃機・巡航ミサイルは event から再現）・プロトコルの版 7、ボットで数値を決定） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/c358968cf28d3bab2a708ec26f6697a695e84b6b（事前修正: 渓谷スラロームを 24 リングに https://github.com/kuroneko0269-code/skyraid/commit/3fb912f5363deb2a6df4ed7202bcd5d300fe9613・レース中は武器の HUD を隠す https://github.com/kuroneko0269-code/skyraid/commit/e9c7420335f0f5915f2ef9d7ad673143d81082ba）
- [x] 7-3 スキン・デカール（塗装パターン 8 種・12 色のパレット・デカール 10 種・尾翼の機体番号、価格と解放条件、機体ごとの塗装テクスチャ（uv1・draw call 増なし）、ハンガーの「塗装」タブ、PvP・協力の名簿に 14 バイト（プロトコル v8）、リプレイのヘッダ、セーブ v8） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/b130b81d4a1f9adf00d6f3459ffce06470b0dc8f
- [x] 7-4 Supabase ランキング（指示により匿名ログインではなくメール OTP + app_metadata の承認制。共有プロジェクトの規約 v1.0・スキーマ skyraid・クラウドセーブ（ローカルが正、3 秒デバウンス、両方変更ならダイアログ）・記録の送信と再送キュー・ランキング 3 タブ（5 分キャッシュ）・CSP の connect-src をビルド時に追加・設計書 docs/supabase-design.md。Supabase での実機確認は人間） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/917941eafc41ad138ed7886019d78e355853df40
- [x] 7-4b メンバー承認のアプリ内管理（skyraid_0002_members.sql: is_owner（API 非公開）・join_requests・approve_member / revoke_member（auth.users の apps の skyraid だけ）・list_members、承認待ちの自動申請と 5 分ごとの再確認、設定「メンバー管理」（owner のみ）、設計書の「規約からの逸脱」節、事前修正: 「セーブデータを削除」の「サーバーのバックアップも削除する」（既定 OFF・OFF なら次の同期でサーバーを受け取る）。Supabase での実機確認は人間） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/49393f0d9b3c2967146492a7f2127d9922ca913c
- [x] 7-4c オンライン連携のログインの修正（コード 4〜10 桁・数字以外を除去・失敗の表示（空 / 桁不足 / 不一致 / 期限切れ / 回数超過 / 通信エラー）・迷惑メールの案内・ホーム画面のアプリではリンク不可の案内、設定・情報画面の見出しとタブの固定（844×390 で 26%）と ui-audit の固定部分の点検） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/474d4ec54ba88cf8d865883f51a884bd8d81c49d
- [x] 7-4d 承認前のユーザーの申請が join_requests に入らない不具合（コードを送るときの 422（新規登録が無効）を「権限がありません」ではなく「このメールは登録できません」に・申請の失敗を握りつぶさず console と画面に「申請の送信に失敗」+ 理由・権限エラーと承認待ちの文言の区別・app_metadata の無いトークン・セッション確立前に送らない・表示名が check に通らなければ PILOT で送り直す、手元の Postgres で Supabase のロールを模した SQL のテスト supabase/tests/、README の owner 付与の SQL（roles が無くても付く）と原因の調べ方。SQL の変更なし（0003 は不要）） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/2a5e0f5c6936ddb523ba38b53f2b6ac718b906a2
- [ ] 7-6 実績・デイリーミッション
- [x] 7-7 フォトモード（→ 7-A で実施）
- [x] 7-A フォトモード（ポーズメニュー / P、機体中心の自由カメラ・プリセット 6 種・画角 / ロール / フォーカス、画面の調整、表示の切替とコマ送り、天候・時刻の上書き、PNG 保存（画面 / 2 倍 / 4K・透かし・共有）、事前修正: 霧のスケールハイト 600m・main.ts の分割） — main マージ: https://github.com/kuroneko0269-code/skyraid/commit/3df498e（事前修正: 霧 https://github.com/kuroneko0269-code/skyraid/commit/77fe9d4・main.ts の分割 https://github.com/kuroneko0269-code/skyraid/commit/29c866b）
- [x] 7-5b 実機の修正: タイトル等に HUD が出る不具合（夜の減光のインライン opacity が隠す CSS に勝っていた → data-hud と CSS 変数）、夕焼けの強化（夕方 12 → 5°・早朝 8 → 6°、低い太陽の大気散乱（Rayleigh・オゾン・散乱の高さ・Mie の光芒）、雲の下面の照り返し、夕方 −0.3EV） — main マージ: https://github.com/kuroneko0269-code/skyraid/commit/44e784d（HUD の修正: https://github.com/kuroneko0269-code/skyraid/commit/c612c4d）
- [x] 7-8 リプレイ（→ 7-B で実施）
- [x] 7-B リプレイ（シングルプレイ 5 モードの入力の記録（1 分 10KB 以下）・決定性の監査とシード付き乱数・再生（速さ 5 段・一時停止・10 秒スキップ・1 秒ごとのキーフレームからのシーク）・カメラ 4 種とフォトモード・IndexedDB の自動 10 本 / 保存 30 本・.skyreplay の書き出し / 読み込み・一覧と操作バー・レースのゴーストを入力の記録へ（セーブ v7）、事前修正: 防衛戦の準備 12 秒と 1〜3 波の敵の削減・協力レイドの味方のロック） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/1fb5424e72f397d5b9a1f7461a944a1429c92126（事前修正: 防衛戦の準備 12 秒・1〜3 波 9 → 7 機 https://github.com/kuroneko0269-code/skyraid/commit/84877a31811a522d27e2fcccb1d1c3710a2ab010・協力レイドの味方のロック https://github.com/kuroneko0269-code/skyraid/commit/e6e96f0fc9ad1cbf91f89067cd1069e3357df039）
- [x] 7-C UI 総点検（実機の iPhone 横画面 844×390 で見つかった不具合: ボタンの折り返し（nowrap・文字に合わせた最小幅・「協力 2〜4人」）、タッチのホバーの貼り付き（hover は @media (hover: hover) の中だけ・タッチ中は focus-visible の枠なし・タップ後にフォーカスを外す）、選択項目のセグメント化（防衛戦・フリーフライト・レイド・ロビーのホスト設定）、HUD の上部パネルの帯（幅 50% 以内・防衛戦の施設・予告・補給は左の帯へ）とトーストの上中央、背の低い画面のスクロール、全画面の目視点検、事前修正: 防衛戦の戦闘機の撤退 60 / 100 秒・リプレイ一覧の「中断（○ 波）」） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/07d055c（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/f9f9df7）
- [x] 7-D メニューの再設計（モード選択を「遊ぶ」7 枚のカード（人数バッジ・進捗）と「管理」のタイルの 2 段に・線画の背景グリフ 12 種（コードで生成）、設定画面の独立（タイトルの歯車・モード選択・ポーズの「すべての設定」から、戻ると開いた元へ。ポーズには画質・音量・操作補助・HUD の 4 つ）、情報画面（版・更新履歴 docs/changelog.md・ライセンス一覧（ビルド時に生成）・データの扱い）、トーストの共通部品、タイトルの歯車と版、自己ベストのセーブ v9、点検スクリプト scripts/ui-audit.js） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/625cce4d258d17a521a7eb95ed6b4f18e35c111b

## フェーズ8: 公開準備

- [x] 8-1 公開チェック（更新履歴 v0.1〜v0.8 と追記のルール・情報画面のライセンスとデータの扱い・公開前の点検リスト `docs/release-checklist.md`（全モードの起動・console / CSP・初回起動・セーブ v1〜v9 の移行・PWA・環境変数なしのビルド）・不要物の整理・版 0.8.0、事前修正: パイロット名の変更・ポーズの HUD の位置・スキンの時間計測を `npm run bench` へ・README のオンライン連携の手順） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/d4d2dd9d1688141a429345851118c7b4ff79414d
- [x] 8-2 性能と容量（計測の基準と `npm run perf`（チャンク一覧・起動時間・モードごとの読み込み・Lighthouse。docs/perf.md）・three の 2 分割と起動時のアプリの game / render / app への分割（500KB 超の警告を解消）・情報画面 / フォトモード / 怪獣のモデル / リプレイの一覧と再生操作の遅延読み込み（読み込み中・失敗のお知らせ、モード選択で先読み）・遅延チャンクのプリキャッシュ、タイトルまでの JS・CSS gzip 412.5KB → 393.3KB、事前修正: 協力ロビーの見出し・環境変数なしで online-app をプリキャッシュしない・icon-source を配信物から外す・README の BGM） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/f11d148b8f138b3f2875568478e91f0c536d76f1（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/be4465ab9254a332a849900ae21ee4b789b327e5）
- [x] 8-3 互換性（最低動作環境 iOS 16.4 / Chrome 105 / Firefox 121 を README・情報画面に・WebGL / WebGL 2 が無い・古いブラウザの案内画面・コンテキスト喪失でポーズと復帰・保存できない環境のお知らせ・スマホの縦画面の案内をメニューにも・`ui-audit.js --browser` と互換性の点検・docs/compat.md、事前修正: meta description） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/03196934681b553ae70be1c925be7118b674d97a
- [x] 8-4 英語化（UI の文言を ja.json / en.json へ・英訳と訳語の一覧 docs/glossary.md・t / tn と Intl の書式・言語の決め方と設定の切り替え（セーブの settings.language）・抜け防止のテスト・legacy-check.js の文言のビルド時の埋め込み・ui-audit.js --lang en・README の英語の概要） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/3a1dc28d718a92a64006ce22c401ccedfe3f4f71
- [x] 8-5 記録カード共有（結果画面（キャンペーン・ソロのレイド・リングレース・ソロの防衛戦）の「記録カード」: 1200×630 の PNG を Canvas 2D で（背景は結果の時点の場面）・パイロット名を載せるかの選択・Web Share API（ファイル付き）/ 画像を保存・文面をコピー・オフラインで生成・遅延チャンク card-dialog、OGP（英語の固定の画像 og-image.jpg）、テストと ui-audit --release の card、事前修正: リプレイの結果を今の言語で・英語の更新履歴の断り・Next Enemy） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/52bf1198a74dc12217c895b3b95dfa43ab0db1a0
- [x] 8-6 実機確認の修正（iPhone の実機確認: 名前をパイロット名に一本化・メンバー管理の名前と行の高さ・横画面の黒い余白・メニューのタップの取りこぼし・排気口の黒い輪・記録カードのフォント・レイドの難易度、版 0.9.0） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/b11d3c436728b22108f3ca2a36852342cb87bb78
- [x] 8-6b 追加修正（M1 のリング後の敵が機銃だけで倒せない → 敵の HP ×0.6・ミサイルの補充、M2〜M5・防衛戦のミサイルなしの表、レイドを通常と高難度で分けて調整、データタブの「パイロット名を変更」を 1 か所に、排気の先の黒い輪（陽炎のシェーダー）と 8-6 のふたの変更を戻す） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/c50b48753b531d426d54c0fc201f578ceb4343f5
- [x] 8-6c 追加修正（協力レイドの人数の補正（2〜4 人の部位ダメージ倍率）・M2 初陣の難易度（easy × 3・HP ×0.6・30 秒間隔）・レイドのブリーフィングのダウンの文を難易度ごとに） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/0f25e1d13ee984a5bdf55486d0fe9880c1ae7bc2
- [x] 8-6d 実機確認の修正 その 2（横向きの起動の黒い余白（ルート要素の大きさ・?debug=viewport）・ダイアログのフォント・キャンペーン共通のミサイルの補充・パイロット名の変更を 1 か所に・メンバー管理の 1 人 1 行の表・横スクロールの点検） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/77a4aef9a28338d34b80803f1b56508e939affbf
- [x] 8-6e 横向きの起動の黒い余白（実機の ?debug=viewport の値から: 描かれる大きさに合わせる・viewport-fit の切り替えで測り直させる試み） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/286b8ebe03bc4f35b5001ab4403cb59a13046402
- [x] 8-6f 測り直しの間のチラつき（viewport-fit の切り替えの間は黒い幕で隠す・試みを順番に） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/01da045e025656f85eea209b2b94a3a1c990aac4
- [x] 8-7 v1.0.0 公開（版 1.0.0・changelog・README の整理・公開前の点検のやり直し（docs/release-checklist.md）・knip の指摘の解消・公開後の候補・タグ v1.0.0、事前修正: リプレイの版の断り・ロビーの「補正」の英訳 Modifiers・起動時の幕のロゴ） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/9bbfa37ad0d23b52a3af9871572b6d73c40f6b53（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/5ca6567e28b92f8bf1fedafda18534213fd5b70f）

## 公開後の修正

- [x] v1.0.1 公開後の修正（横向きの起動の下の余白の退行: 向きが遅れて決まる起動で幕と測り直しが動かなかった → 起動 8 秒の見張り・?debug=viewport の startup / cover / nudge の記録・ロゴの失敗で止めない・点検に縦 → 横の起動、公開 URL をリポジトリから外す、英語のデカール名を短く、テストの時間の判定を bench へ・時間切れの既定 60 秒、GitHub Actions のリリース（release.yml）とブランチの掃除（cleanup-branches.yml）、版 1.0.1） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/30750bb206197f8da7dfdedc0a5cb911e36d5e8a

フェーズ 8 は 8-7（v1.0.0 の公開）で閉じる。フェーズ 9 は 9-11b（v1.1.0 の公開）で閉じる。以後の作業は下の候補から選び、指示を受けてから 1 タスクずつ行う。

## 公開後の候補（v1.1.0 の時点。順番は未定・指示があるまで実装しない）

- [ ] P-1 タイトル・メニューと飛行の分離: タイトル・モード選択の裏で飛行の世界（地形・空・デモカメラ）を作らずに起動し、飛ぶときに読み込む（起動時間・メモリ・横向きの起動の測り直しを軽く。8-2 の遅延読み込みの続き）
- [ ] P-2 マルチの記録カード: PvP・協力レイド・協力防衛戦の結果画面にも「記録カード」（8-5 はソロの 4 モードだけ。全員の名前・撃墜数・役割を載せるか、載せる名前の選び方を決める。フェーズ 9 で増えた練習場・日替わりの結果にも出すかも）
- [x] P-3 タッチの機銃の当たりやすさ（9-3・9-5b・9-5d で実施: 狙いの補助の強さ・自動射撃・補助の組）: タッチの機銃が当たりにくい（8-6d の計測: M2 の 1 発あたりの命中率は「人に近い」ボットで 2.2〜3.6%、平均的なボットで 6.2〜6.7%）。エイムアシスト・判定の拡大の数値の見直し（飛行モデルの数値は変えない。変えるなら前後の値を記録）
- [ ] P-4 Firefox / WebKit の点検: `ui-audit.js --browser all`・互換性・記録カードを Firefox と WebKit で（クラウドではブラウザを取得できず未実施。手元か実機で。docs/compat.md）
- [ ] P-5 ランキングの記録の扱い: 版をまたいだ記録（数値の調整の前後）を同じ表に並べるか、版で分けるか・リセットするか。不正な記録の削除の手順（owner の操作）、表示の期間（全期間 / 月間）
- [ ] P-6 勲章の称号: 勲章の名前をプロフィール・ランキング・ロビーの名前の横に出す（9-10b で見送り。ランキングに出すにはサーバーの表と送る値が要るので P-5 と一緒に）
- [ ] P-7 勲章の報酬の塗装・デカール: 今の報酬はクレジットだけ（9-10 / 9-10b）。節目・集めの報酬に専用の塗装・デカールを（テクスチャの生成の追加が要る）
- [ ] P-8 キーボード・パッドの補助: 補助の組（9-5d）・狙いの補助の強さ・自動射撃・速度合わせはタッチだけ。キーボード・パッドにも組を効かせるか（パッドの今の操作感を変えない形で）
- [ ] P-9 リングレース「夕空アクロバット」の 15 番: 方向へ倒す方式のボットは 4 機種とも通れない（9-8。ブーストの後で機首を押し下げる速さが足りない）。実機でもコースが難しく確かめられなかった（9-11b）。方向へ倒す方式の数値（diveRoll の条件・押す強さ）か、リングの位置（記録と合わなくなる）を変えるか
- [ ] P-10 怪獣の画像の差し替え: レイドの怪獣選びの画像（9-10d。ゲームの描画から `npm run render-kaiju-art`）を、フォトモードで撮った写真に差し替える（手順は README の「怪獣の画像の差し替え」）
- [ ] P-11 1.1.0 の後の実機確認: キャンペーン M6〜M8 と、協力（レイド・防衛戦）・PvP の 2 台での確認（9-11b で未実施）。何かあれば 1.1.x で直す

## フェーズ9: 操作の改善と内容の追加（v1.1.0）

版の付け方: 遊ぶ人に見える変更を含むタスクごとに 1.0.x を 1 つ上げる（ツール・文書だけ、未完成で `?dev=` の URL フラグの裏に隠している機能だけのタスクは上げない）。9-11 の完了で 1.1.0（CLAUDE.md「更新履歴」）。

- [x] 9-1 操作の診断（リプレイの入力を解析するツール `npm run analyze-replay`・実機とボットの比較・docs/control-analysis.md に難しさの原因と 9-2 / 9-3 の推奨値） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/950c536d3d60791aa5eb76e2bc72a4b65c91be9a
- [x] 9-2 スティックの改善（感度のカーブ・スティックの方式・感度の設定の範囲。9-1 の推奨値から） — main マージ: https://github.com/kuroneko0269-code/skyraid/commit/765e67008fb876f528215ab516e851f8ffbcf8fd
- [x] 9-3 狙いの補助と宙返り（エイムアシストの強さ（弱・標準・強）・自動射撃・PvP の部屋の補正・「方向へ倒す」方式の宙返りと NEED SPEED・チュートリアル・効果の表・端末をまたいだずれの調査。P-3 を含む） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/7827fbe46f18bfb49dfa139262f8cf119703c3ad
- [x] 9-4 傾き操作とドラッグ操作（操縦（タッチ）の傾き・ドラッグ・iOS の許可・中立と合わせ直し・チュートリアル・模擬の人の比較、事前修正: リプレイの毎秒の丸めたハッシュ・始めの誤報・方向へ倒す方式の真下まで（アクロバットの 11 番）・ロビーの補正の 2 × 2、版 1.0.4） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/33072fd15c0f5116f3e150304e615fff5a471a8d
- [x] 9-5 練習場（止まった的・動く的・模擬の敵（60 / 75 / 90 秒・機銃だけ・撃墜されない）・結果のスコア / 命中率 / 撃墜までの平均と 9-1 と同じ数え方の指標 3 つ・助言・一覧 / ポーズ / 結果の設定の欄と「やり直す」・設定ごとの記録（records.practice）・リプレイ・チュートリアルと M1 / M2 の失敗の案内、事前修正: touch-controls.ts の分割、版 1.0.5） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/8d8f699387c2a3d16a411fcc034c97351ac2254a
- [x] 9-5b 実機確認の修正（照準のずれ・照準の印の整理・速度合わせ・射程外の射撃・真上 / 真下の横回転・記録の自動射撃とボタンの区別・練習場の指標・効果の表、版 1.0.6） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/cbeddd025ddd4ae4ce99ed912f174bd5bf061139
- [x] 9-5c チュートリアルの作り直しと練習場の助言（9 章（操縦・速さ・照準と機銃・動く的・ミサイル・フレア・宙返り・的の選び方と探し方・補助の設定と練習場）・達成の条件とヒント・6 方式 × 日本語 / 英語の文と図・章の一覧と ✓・「新しくなりました」・練習場の結果の問題 3 つと良かった点・飛行中の一言・ボットの全章の通し・助言の当たり方、版 1.0.7） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/b28395db5ccb5d736b383bcb5034efdca699e181
- [x] 9-6a 新しい怪獣（空を飛ぶ）その 1（設計 docs/kaiju2.md「ネフィルガ」・コードで作るモデル（三角形 高 5,110 / 低 1,282・draw call 2〜4）・決まった計算の動き（周回・攻撃 4 種の予兆と見た目・止まり木・部位の壊れ）・`?dev=kaiju2` の確かめる場と値の表示（遅延チャンク）、事前修正: 新しい版のセーブを初期化しない・英語のモードカードの ui-audit。版は上げない） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/2e0a3a725535722e0fc71c4775b130583d13e8c0（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/9ab1cdfbf0ccc57e05e57a14cd0a6997c488114c）
- [x] 9-6b 新しい怪獣（空を飛ぶ）その 2（ソロのレイドへの組み込み: レイドのダイアログで怪獣を選ぶ・撃てる部位 5 つと部位の破壊で動きが変わる・段階と止まり木と急降下の隙・嵐 4.5 分と全体 12 分の制限時間・一撃で落ちないダメージ・HUD / ブリーフィング / 音 / 結果 / 記録カード / リプレイ（日本語・英語）・本番の判定を回すボット（熟練・平均的・模擬の人）で調整、事前修正: 568×320 の設定「操作」・spec のヴォルガスの数値・翼をたたんだ形。`?dev=kaiju2` の裏・版は上げない） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/0511155fc3b8f60425e0e141acd2684456c84ec2（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/47e76da1b41469bd587993c8f4dbca33d163c333）
- [x] 9-6c 新しい怪獣（空を飛ぶ）その 3（協力: ホストが判定・state のネフィルガの欄・写し・狙う人だけに当たる攻撃・人数の補正 ×1 / ×1.85 / ×2.65 / ×3.5・再接続・通信の版 10 とロビーの表示、急降下の出番、負けの理由（嵐 / 全体 / 戦域外）、自己ベストとランキングのキー（SQL 0003 は未実行のため送らない）、`?dev=kaiju2` を外して公開（レイドの入口で怪獣を選ぶ・遅延読み込み）、ソロ・協力 × 通常・高難度 × 4 役の調整の表、事前修正: 568×320 のチュートリアルの指示の欄、版 1.0.8） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/3bb77b9a90db61189404ce958319126e4c554419
- [x] 9-5d 補助の組と練習場の画面（補助の組 かんたん / ふつう / むずかしい と「カスタム」・設定 → 操作の先頭 / 練習場の設定 / チュートリアルの補助の章・初回と今の利用者に 1 回だけ選ぶ画面・飛行中の一言を照準の近くに / 手動の要素の組だけ / 見失いに的の向き・練習場の選択画面を概要 / 記録 / 設定のタブに・組ごとのボットの表、事前修正: ネフィルガのランキングを有効に、版 1.0.9） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/047ecdabc25863adbf4489b0f20aa093fbf2ff2d（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/fdd3d32563480c00a1dd3fa5842533d04c893f8a）
- [x] 9-6d ネフィルガの手応え（手応えの指標（1 分あたりの攻撃・攻撃 1 回あたりの被弾率・クリア時の体力の減り・撃墜（攻撃 / 墜落））と変更前の値・攻撃の間隔と重ね・雷球の見越しと散らばりと追尾・突風の範囲と押し流し・急降下の見越し・部位を壊すと怯む・狙われたら避ける・狙いの補助を怪獣の部位だけ弱める・止まり木へ旋回しながら降りる / 羽ばたいて上がる（協力の写しも同じ）・レイドの残機（ヴォルガス・ネフィルガ共通、通常 3・高難度 2、協力は 1 人ずつで観戦・全員で失敗、通信の版 11）・ソロ / 協力 × 4 役の調整の表とヴォルガスの測り直し、版 1.0.10） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/42ce0603d41373cefd71764965505112cb2b9b57
- [x] 9-7 キャンペーン M6〜M8（M6 夜間迎撃（島・夜・敵機 6 機が 3 波）・M7 対空陣地（港湾都市・霧・施設 4 つと対空砲 4 門）・M8 決戦（キャンペーン版のネフィルガ: 数値の差し込み口 `KAIJU2_RAID_CONFIG.campaign`・街の上の止まり木を避ける・登場 / 段階 / 撃破の演出と天候）・解放と評価と報酬は M1〜M5 と同じ・一覧を背の低い画面で 2 列・ネフィルガを出すたびに値を戻す（リプレイの決定性）・役 4 つ × 補助の組 2 つのボットの表、事前修正: レイドの高難度の残機 3・ヴォルガスの通常の最終フェーズ 5.5 分、版 1.0.11） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/6123f4fbab71cf706b416f4152bbf7594be0da63
- [x] 9-8 リングレースのコース 2 本（道案内: 次・その次の番号の札とそれより先を控えめに・画面端の矢印と距離・宙返り / 上へ / 下へ / 引き起こしの印・道筋の点線（設定で OFF）・通り損ねの表示、スタート前のコースの下見（初めてのコースだけ自動・タップで飛ばす・判定は止める）、新コース「夜景クルーズ」（入門・港湾都市の夜・広いリング）と「峰のらせん」（中級・島の夜明け）、SQL 0004（未実行のため新コースは送らない）、方向へ倒すボットで 6 コース × 4 機種の完走と模擬の人の表、ui-audit-race.js、事前修正: 速度合わせを空の的だけに、版 1.0.12） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/21586fdbe858f3fa8414bb3543bae6d30c9ef722
- [x] 9-9 日替わりチャレンジ（日本時間の 0 時で切り替え・日付から整数の演算で選ぶ条件（種類・難しさ ★1〜3・機体（強化なし）・天候）・課題 4 種（的あて 120 秒・動く的 120 秒・敵機の連戦 150 秒・海岸周回 2〜4 周の周回レース）・スコアと補助の組・連続日数（records.daily）・日替わりの画面とメンバー内の今日のランキング（SQL 0005 は未実行のため送らない・つながったら未送信の最高を送る）・リプレイのヘッダの条件・モード選択の並び替え（日替わりの大きなカード / 上の帯・4 × 2・説明の折り返し）・端末 / 言語 / 時間帯をまたいだ条件とリプレイのテスト、事前修正: 新コース 2 本のランキングを有効に、版 1.0.13） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/26e5af3901a59c7d2a45eb492bc6210393c23999（事前修正 https://github.com/kuroneko0269-code/skyraid/commit/8d2f2c10b5f1cfda77f99d24401a78e33eb6eec0）
- [x] 9-9b 実機確認の修正（回転の後の配置: 大きさの条件を body のコンテナの `@container app` に・`pickRootSize` は screen を超える古い値を使わない・HUD の小さい表示も body の大きさで、画面の切り替え直後の押し抜け（切り替えの前に押し始めたタップのクリックを 1 秒捨てる。全画面共通）とリプレイの一覧の「← モード選択」（同じ原因）、リングレースの下見（全部のリングと点線・カメラの前のリングを発光）と飛行中の点線（自機 → 次 → その次の 2 区間・細く薄く）、飛行の始めの天候を補間なしに、点検 `ui-audit-device.js --only passthrough,rotate,weather`、事前修正: ui-audit の PC の撮影の遅さ（メニューの間の描画を 1 秒に 1 回に・`--size`・経過秒）、版 1.0.15） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/72c886268510f3df33dc5502464114b87fc98942
- [x] 9-10 勲章・実績（28 個（キャンペーン・リングレース・日替わりの連続は銅・銀・金）・報酬はクレジット 1 回だけ（合計 46,500 CR）・補助ふつう以上の 4 つ・飛行の決まった計算の値を読む観測役（リプレイで同じ結果）・記録からのさかのぼり・飛行を出た画面でまとめてお知らせ・モード選択の「勲章」の一覧・協力 / PvP は対戦の集計から・セーブ v10、事前修正: 日替わりのランキングを有効に・日替わりの HUD の課題名・日替わりの「リプレイを保存」・モード選択の日替わりの帯 36px、版 1.0.14） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/b401cb03157c308945ce9c7d58645fd6070a0cba
- [x] 9-10b 勲章の拡充（通算の記録 `stats`（撃墜の武器・種類・難易度別、出撃・成功のモード・遊んだもの・難易度・補助の段・機体別、飛行時間・距離、機動の回数、リング、防衛の波、部位破壊、被弾なし・撃墜されずのクリア、日替わりの日数、協力の人数別、PvP の遊んだ・勝ち・撃墜）・セーブ v11、勲章 28 → 279 個（段階の数え 151・組み合わせ 96・集め 4。隠し 14）、報酬は 1 つ 100 CR・10 個ごとの節目 500 CR・集め 1,000〜8,000 CR、勲章の画面を左に一覧・右に詳細とカテゴリ / 状態 / 並びに、版 1.0.18） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/52eca4cf11e763e02c45acf964db731ee94d4249
- [x] 9-10c 勲章の作り直し（名前をすべて「〜した」の条件の文に（英語は過去形の文）・段階付きの 3 つを 1 段ずつに分ける（セーブは読むときに移す）・重なる 5 つを組み合わせにまとめる・並びをカテゴリ 通算〜収集の順に、同じ種類の段を続けて・番号 No.001〜（表示だけ。記録は id）・「同じ段の勲章」・画面を 3 列（カテゴリ / 一覧 / 詳細。568×320 はカテゴリを上の横一列）、版 1.0.19） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/6fbbc93696b778416c0ea689552cbf145481b064
- [x] 9-10d 画面の作り直し（練習場の結果: 上の帯・助言の番号付きの札と良かった点・指標の 4 × 2 の札と助言に出た指標の印、レイドの怪獣選び: 左に怪獣の大きな画像（`npm run render-kaiju-art` で描く）・右に概要 / 攻撃 / 攻めどき / 難易度と残機・自己ベスト、PvP / 協力のロビー: 上の帯に部屋コード・左に席の一覧・右に「ルール」「補正」のタブ・下の帯に機体 / 定型文 / 待ちの文 / 主のボタン、ui-audit の 3 サイズ・回転・押し抜けの点検） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/66b789bb9f890dafa3e1086d8a61a8e8faa11827
- [x] 9-11a 全体の調整と公開前の点検（保留の調整: M2 初陣の敵機 HP ×0.6 → ×0.8、ヴォルガスの高難度・練習場のむずかしい・チュートリアルの照準と機銃の長さ・クレジットの釣り合いは測って変えない（表は docs/control-analysis.md）、モード選択の「チュートリアル」の押し抜けと点検 `ui-audit-device.js --only cards`、英訳の見直しと docs/glossary.md、公開前の点検（docs/release-checklist.md。互換性・セーブの移行・前の版のリプレイは省略）、README・spec、版 1.0.16） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/d0065cb860137e20618aa49d1bc528b25d8f09c6
- [x] 9-9c 画面の見直し（記録カードのボタンをプレビューの下に・共有の文面の欄を広げる、リプレイの一覧を画面の高さいっぱいに、練習場の結果を「助言・指標・設定」のタブに、844×390 で縦にスクロールする画面の洗い出しと修正（リングレースのコース一覧・ハンガー・練習場のポーズ・チュートリアルの章の一覧・ブリーフィング / 結果）、回転の点検を src/ui の全部の画面とダイアログに・開いたダイアログの配置の作り直し、版 1.0.17） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/31213983769795cfdd023e94e5e8da98246697fe
- [x] 9-11b 実機確認の修正と 1.1.0 の公開（M6 の目標に「objectives.wave」と出る（目標の名前の getter を `...` で広げて、文言の表を読む前に値が決まっていた）・表を読む前のモジュールの評価のテスト・ui-audit の生のキーの点検（`rawKey`・`--release` の rawKeys で全ミッション・全モード）、changelog の 1.1.0 の要約、README、公開後の候補、公開前の点検、版 1.1.0） — main squash マージ: [87527e8](https://github.com/kuroneko0269-code/skyraid/commit/87527e878f7c5e745714baf41a5bf549bb162065)

## フェーズ10: 新しいレイドの怪獣と起動の軽量化（v1.1.x）

版の付け方: 当分は 1.2.0 に上げず、遊ぶ人に見える変更を含むタスクごとに 1.1.x を 1 つ上げる（ツール・文書・テストだけ、未完成で `?dev=` の URL フラグの裏に隠している機能だけのタスクは上げない。CLAUDE.md「更新履歴」）。新しい怪獣はゲーム本体・それぞれの遅延チャンクに入れ、起動の量の上限（10-1。`scripts/startup-budget.js`）を上げずに足す。

- [x] 10-1 起動の軽量化（タイトルまでに読む量の内訳の表・タイトルとメニューに要らないものを使うときに読む形へ・先読みと読み込み中の表示とオフライン（プリキャッシュ）と失敗の扱いを保つ・起動の量の上限を点検に・docs/perf.md に変更前後の表、タイトルまで gzip 484.9KB → 283.6KB（−41.5%）・上限 320KB、版 1.1.1） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/4b3d2fc2f1a5674a75ccd52fd451bcf157496f16
- [x] 10-1b 起動の演出（iOS のホーム画面から横向きで起動したときの測り直しの幕のロゴが、揺れの後にタイトルの文字の位置と大きさへ移って重なってから幕が明ける・ロゴと文字の見た目をそろえる・幕の間に本体を読む・視差効果を減らす設定では動かさない・重なりのずれの点検、版 1.1.2） — main squash マージ: https://github.com/kuroneko0269-code/skyraid/commit/6fe2dcdbc0a84d8d44cb3e939befeb2d2fe9aae7
- [ ] 10-2 レイドの怪獣の共通の土台（3 体を足す前に、怪獣ごとの定義・判定・描画・HUD・協力の写し・記録の差し込み口を共通にする）
- [ ] 10-3a 新しい怪獣「白鯨」その 1
- [ ] 10-3b 新しい怪獣「白鯨」その 2
- [ ] 10-4a 新しい怪獣「メカ怪獣」その 1
- [ ] 10-4b 新しい怪獣「メカ怪獣」その 2
- [ ] 10-5a 新しい怪獣「UFO」その 1
- [ ] 10-5b 新しい怪獣「UFO」その 2
- [ ] 10-6 まとめの調整と点検

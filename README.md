# SkyRaid: Titan Skies

ブラウザで動く3Dフライトシューティング。

```
npm ci
npm run dev
```

仕様は `docs/spec.md`、計画は `docs/plan.md` を参照。

## ブランド素材の差し替え

`public/brand/` のファイルを同じ名前で置き換えると、ビルド後にそのまま使われます。

| ファイル | 用途 | 推奨 |
| --- | --- | --- |
| `public/brand/logo.png` | タイトル画面のロゴ。**置けば画像、無ければテキストのロゴ** | 横長・背景透過の PNG。透明な余白はトリム、幅 2000px・500KB 以下。表示は画面の幅の 46%（最大 760px）・高さの 24% に収める |
| `public/brand/icon-source.png` | アイコンの元画像（配信・プリキャッシュには使わない） | 正方形（1024px 以上）。角丸の外は白 |
| `public/brand/icon-512.png` | PWA のアイコン（ホーム画面・スプラッシュ） | 512×512。角丸・外は透明 |
| `public/brand/icon-192.png` | PWA のアイコン・ブラウザのタブ（PNG に対応したもの） | 192×192。角丸・外は透明 |
| `public/brand/icon-maskable-512.png` | PWA の maskable アイコン（Android が形を切り抜く） | 512×512。全面を塗り、絵は中央 80% の円に収める |
| `public/brand/apple-touch-icon.png` | iOS のホーム画面 | 180×180。全面を塗る（iOS が角を丸める） |
| `public/brand/favicon.ico` | ブラウザのタブのアイコン | 16・32・48px を含む ICO |

アイコンを差し替えるときは `icon-source.png` を置き換えて `python3 -I scripts/brand-icons.py public/brand`（Pillow が必要）を実行すると、上の 5 つを作り直し、ロゴの余白もトリムします。

アプリ名・テーマ色は `src/data/app.ts`、セキュリティヘッダーは `public/_headers`（Cloudflare Pages の形式）。

## BGM の差し替え

効果音はすべてコードで合成しているので音声ファイルはいりません。BGM だけは次の場所に MP3 を置くと流れます（無ければ無音）。

| ファイル | 流れる画面 |
| --- | --- |
| `public/audio/bgm/title.mp3` | タイトル・モード選択・ミッション一覧・ブリーフィング・ハンガー |
| `public/audio/bgm/flight.mp3` | 飛行中・ポーズ中 |
| `public/audio/bgm/result.mp3` | リザルト |

- ループ再生し、画面が変わると 1 秒でクロスフェードします。ループの継ぎ目が目立たないよう、曲の頭と終わりをつなげて作ってください
- 1 ファイル 25MB 以下（Cloudflare Pages の制限）。数 MB に収まる 128〜192kbps 程度を推奨。オフライン用のキャッシュ（Service Worker）には入りません
- 置き換えたら `npm run build` して公開するだけです（コードの変更はいりません）。音量はポーズメニューの「設定」の BGM のスライダー
- ライセンスが明確な素材（CC0 / CC-BY）だけを使い、出典を `docs/assets.md` に書いてください

### 音が鳴らないとき

- ブラウザの制限で、最初に画面をタップ（クリック・キー入力）するまで音は出ません
- **iPhone / iPad はサイレントスイッチ（消音モード）がオンだと鳴りません**（Safari の Web Audio の仕様です）。スイッチをオフにするか、音量ボタンで音量を上げてください
- タブを裏に回すと止まり、戻ると再開します


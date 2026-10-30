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

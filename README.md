# SkyRaid: Titan Skies

ブラウザで動く3Dフライトシューティング。

```
npm ci
npm run dev
```

仕様は `docs/spec.md`、計画は `docs/plan.md` を参照。

## ブランド素材の差し替え

`public/brand/` のファイルを同じ名前で置き換えると、ビルド後にそのまま使われます（今入っているのは仮のアイコン）。

| ファイル | 用途 | 推奨 |
| --- | --- | --- |
| `public/brand/logo.png` | タイトル画面のロゴ。**置けば画像、無ければテキストのロゴ**（今は無い） | 横長・背景透過の PNG。幅 1440px 程度、25MB 以下 |
| `public/brand/icon-512.png` | PWA のアイコン（ホーム画面・スプラッシュ。maskable も兼ねる） | 512×512 の PNG。中央 80% に収める |
| `public/brand/icon-192.png` | PWA のアイコン・iOS のホーム画面（apple-touch-icon） | 192×192 の PNG |
| `public/brand/favicon.ico` | ブラウザのタブのアイコン | 16・32・48px を含む ICO |
| `public/brand/icon.svg` | 仮アイコンの元の絵（SVG に対応したブラウザのタブ・manifest） | 差し替えるなら同じく正方形の SVG |

アプリ名・テーマ色は `src/data/app.ts`、セキュリティヘッダーは `public/_headers`（Cloudflare Pages の形式）。

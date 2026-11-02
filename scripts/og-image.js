/* global console, document, Image, Buffer */
// 8-5: OGP の固定の画像 public/brand/og-image.jpg（1200×630・英語。JPEG: Service Worker のプリキャッシュに入れない・軽い）を作る。記録カードと同じ描画（src/ui/card/og-image.ts）を
// 開発サーバーのページで動かして JPEG にする。使い方: `node scripts/og-image.js`（ロゴ public/brand/logo.png を差し替えたら作り直す）
// Playwright はクラウドセッションに入っているもの（依存には足さない）
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = 'public/brand/og-image.jpg';
const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // アプリは起動させない（モジュールだけ読む）
  await page.route('**/src/main.ts', (r) =>
    r.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto(url);
  const data = await page.evaluate(async () => {
    await document.fonts.load('600 48px Rajdhani').catch(() => undefined);
    await document.fonts.ready;
    const logo = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = '/brand/logo.png';
    });
    const m = await import('/src/ui/card/og-image.ts');
    return m.drawOgImage(logo).toDataURL('image/jpeg', 0.9);
  });
  writeFileSync(OUT, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${OUT} を書き出しました`);
} finally {
  await browser.close();
  await server.close();
}

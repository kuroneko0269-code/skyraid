/* global console, process, window, document, localStorage, Buffer, URL */
// 9-10d: レイドの怪獣選びの画像を、ゲームの描画で作る（`npm run render-kaiju-art [-- <怪獣の id>...]`）。
// 開発サーバーを立て、画質「高」・?dev=kaiju-art でソロのレイドに出て、場面の秒数（src/data/kaiju-profiles.ts の
// scene.waitSeconds）を待ってから、怪獣ごとの構図（天候・カメラ）で 1 枚撮る（src/ui/kaiju-art.ts）。
// 出力は public/kaiju-art/<id>.webp（960 × 960）。フォトモードで撮った写真に差し替えるときは README の「怪獣の画像」。
// 10-2: 怪獣の一覧は登録簿（src/data/raid-kaiju.ts の RAID_KAIJU）から読む（新しい怪獣も同じ手順で描ける）。未公開の怪獣は
// その ?dev=<名前> を付けて開き、解放の条件は ?dev=kaiju-art のときは見ない。新しい怪獣は遅延チャンクで基準点を登録する
// （src/missions/raid-kaiju-hooks.ts の artAnchor）
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { pickBrowsers } from './audit-browsers.js';
import { pickAssistPreset, seed, shown } from './audit-helpers.js';

const OUT = new URL('../public/kaiju-art/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'warn' });
await server.listen();
// 登録簿の怪獣（id と未公開の ?dev= の名前）
const registry = await server.ssrLoadModule('/src/data/raid-kaiju.ts');
const ALL = registry.RAID_KAIJU.map((k) => k.id);
const devOf = new Map(registry.RAID_KAIJU.map((k) => [k.id, k.dev]));
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ids = only.length > 0 ? ALL.filter((id) => only.includes(id)) : ALL;
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
// 描画はブラウザに任せる（クラウドの GPU の無い環境ではソフトウェアの描画。遅いが同じ絵になる）
const browser = await pickBrowsers('chromium')[0].launch();
try {
  for (const id of ids) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      locale: 'ja-JP',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => console.error(`pageerror: ${String(e).slice(0, 300)}`));
    await page.goto(base);
    await seed(page);
    // 画質は「高」（手動の設定として。自動で下げない）
    await page.evaluate(() => localStorage.setItem('skyraid.quality', 'high'));
    const dev = devOf.get(id);
    await page.goto(`${base}?dev=kaiju-art${dev ? `,${dev}` : ''}`);
    await shown(page, '.title-screen');
    await page.locator('.title-screen').click({ position: { x: 40, y: 360 } });
    await shown(page, '.mode-select-screen');
    await page.click('.mode-card[data-mode="raid"]');
    const wrap = page.locator('.raid-select-wrap:not([hidden])');
    await wrap.waitFor();
    const seg = wrap.locator(`.raid-kaiju-seg .ui-seg-item[data-value="${id}"]`);
    if (await seg.count()) await seg.click();
    await wrap.locator('.raid-solo').click();
    await pickAssistPreset(page);
    await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight', null, {
      timeout: 120000,
    });
    await page.waitForFunction(() => window.__kaijuArt !== undefined);
    const wait = await page.evaluate((k) => window.__kaijuArt.waitSeconds(k), id);
    // ミッションの時計で待つ（遅い描画でも同じ場面になる）
    await page.waitForFunction((s) => window.__kaijuArt.elapsed() >= s, wait, {
      timeout: 15 * 60 * 1000,
      polling: 500,
    });
    const url = await page.evaluate((k) => window.__kaijuArt.shoot(k), id);
    const data = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (!url.startsWith('data:image/webp'))
      throw new Error(`webp で書き出せなかった: ${url.slice(0, 30)}`);
    writeFileSync(`${OUT}${id}.webp`, data);
    console.log(`${id}: public/kaiju-art/${id}.webp (${(data.length / 1024).toFixed(0)} KB)`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

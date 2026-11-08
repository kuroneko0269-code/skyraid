/* global console, process, window, document, localStorage, Buffer, URL */
// 10-7a: ネフィルガの見た目の試作の前後の記録（`node scripts/kaiju2-visual-pilot.js <before|after> [--measure] [--quality high|low]`）。
// 開発サーバーを立て、画質「高」・?dev=k2shot でネフィルガのソロのレイドに出て、決まった場面（src/data/kaiju2-shots.ts）を
// 昼と嵐の空で撮る（src/ui/kaiju2-shot.ts）。出力は docs/visual-pilot/<before|after>/<天候>-<場面>.webp。
// --measure は場面ごとの怪獣の描画の重さ（draw call・三角形・描く時間）を docs/visual-pilot/<before|after>-<画質>.json に書く
// （クラウドはソフトウェアの描画なので時間は目安）
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { pickBrowsers } from './audit-browsers.js';
import { pickAssistPreset, seed, shown } from './audit-helpers.js';

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith('--')) ?? 'after';
const measure = args.includes('--measure');
const qi = args.indexOf('--quality');
const quality = qi >= 0 ? (args[qi + 1] ?? 'high') : 'high';
const noShots = args.includes('--no-shots');
const DOCS = new URL('../docs/visual-pilot/', import.meta.url).pathname;
const OUT = `${DOCS}${label}/`;
mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
const browser = await pickBrowsers('chromium')[0].launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => console.error(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(base);
  await seed(page);
  // 画質は手動の設定として（自動で下げない）。セーブがあるとセーブの設定を読むのでそこへ書く
  await page.evaluate((q) => {
    const save = JSON.parse(localStorage.getItem('skyraid.save') ?? '{}');
    save.settings = { ...save.settings, quality: q };
    localStorage.setItem('skyraid.save', JSON.stringify(save));
  }, quality);
  await page.goto(`${base}?dev=k2shot`);
  await shown(page, '.title-screen');
  await page.locator('.title-screen').click({ position: { x: 40, y: 360 } });
  await shown(page, '.mode-select-screen');
  await page.click('.mode-card[data-mode="raid"]');
  const wrap = page.locator('.raid-select-wrap:not([hidden])');
  await wrap.waitFor();
  await wrap.locator('.raid-kaiju-seg .ui-seg-item[data-value="nephirga"]').click();
  await wrap.locator('.raid-solo').click();
  await pickAssistPreset(page);
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight', null, {
    timeout: 180000,
  });
  await page.waitForFunction(() => window.__k2shot !== undefined, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__k2shot.elapsed() >= 1, null, {
    timeout: 10 * 60 * 1000,
    polling: 500,
  });
  // --scenes a,b / --weathers day で一部だけ（見た目の調整用）
  const pick = (name, all) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '').split(',').filter((x) => all.includes(x)) : all;
  };
  const scenes = pick('--scenes', await page.evaluate(() => window.__k2shot.scenes));
  const weathers = pick('--weathers', await page.evaluate(() => window.__k2shot.weathers));
  console.log(`where: ${JSON.stringify(await page.evaluate(() => window.__k2shot.where()))}`);
  const report = {};
  for (const w of weathers) {
    for (const s of scenes) {
      if (!noShots) {
        const url = await page.evaluate(([a, b]) => window.__k2shot.shoot(a, b), [s, w]);
        if (!url.startsWith('data:image/webp')) throw new Error(`webp で書き出せなかった: ${s}`);
        const data = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        writeFileSync(`${OUT}${w}-${s}.webp`, data);
        console.log(`${label}/${w}-${s}.webp (${(data.length / 1024).toFixed(0)} KB)`);
      }
      if (measure && w === 'storm') {
        if (noShots) await page.evaluate(([a, b]) => window.__k2shot.shoot(a, b), [s, w]);
        report[s] = await page.evaluate((a) => window.__k2shot.measure(a), s);
        console.log(`${s}: ${JSON.stringify(report[s])}`);
      }
    }
  }
  if (measure) {
    const file = `${DOCS}${label}-${quality}.json`;
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`measure: ${file}`);
  }
  await context.close();
} finally {
  await browser.close();
  await server.close();
}

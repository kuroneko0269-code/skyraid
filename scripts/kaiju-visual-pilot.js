/* global console, process, window, document, localStorage, Buffer, URL */
// 10-7b: 怪獣の見た目の前後の記録（10-7a の kaiju2-visual-pilot.js を怪獣ごとに使えるようにした）。
// `node scripts/kaiju-visual-pilot.js <nephirga|albion|gourai|xenolith> <before|after> [--measure] [--quality high|medium|low] [--out <dir>]
//  [--scenes a,b] [--weathers day] [--no-shots]`
// 開発サーバーを立て、?dev=kshot でその怪獣のソロのレイドに出て、決まった場面（src/data/<怪獣>-shots.ts）を決まった天候で撮る
// （src/ui/kaiju-shot.ts）。見た目だけの乱数（Math.random）は決まった種にする（前後で粒の出方をそろえる）。
// 出力は docs/visual-pilot/<怪獣>/<before|after>/<天候>-<場面>.webp。--measure は場面ごとの怪獣の描画の重さ（draw call・
// 三角形・描く時間）を docs/visual-pilot/<怪獣>/<before|after>-<画質>.json に書く（クラウドはソフトウェアの描画なので時間は目安）
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { pickBrowsers } from './audit-browsers.js';
import { pickAssistPreset, seed, shown, XENOLITH_UNLOCKED } from './audit-helpers.js';

const args = process.argv.slice(2);
const free = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const kaiju = free[0] ?? 'nephirga';
const label = free[1] ?? 'after';
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const measure = args.includes('--measure');
const quality = opt('--quality', 'high');
const noShots = args.includes('--no-shots');
const DOCS = new URL(`../docs/visual-pilot/${kaiju}/`, import.meta.url).pathname;
const OUT = opt('--out', `${DOCS}${label}/`);
mkdirSync(OUT, { recursive: true });

// ファイルを見張らない（撮っている間にソースを直しても読み直さない）
const server = await createServer({
  server: { port: 0, strictPort: false, hmr: false, watch: null },
  logLevel: 'warn',
});
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
const browser = await pickBrowsers('chromium')[0].launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'ja-JP',
  });
  // 見た目だけの乱数を決まった種に（判定の乱数は種の列なので影響しない）
  await context.addInitScript(() => {
    let a = 0x1234567;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => console.error(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(base);
  // ゼノリスは解放の条件（ほかの 2 体を通常でクリア）を満たした自己ベストで
  await seed(page, kaiju === 'xenolith' ? XENOLITH_UNLOCKED : null);
  // 画質は手動の設定として（自動で下げない）。セーブがあるとセーブの設定を読むのでそこへ書く
  await page.evaluate((q) => {
    const save = JSON.parse(localStorage.getItem('skyraid.save') ?? '{}');
    save.settings = { ...save.settings, quality: q };
    localStorage.setItem('skyraid.save', JSON.stringify(save));
  }, quality);
  await page.goto(`${base}?dev=kshot`);
  await shown(page, '.title-screen');
  await page.locator('.title-screen').click({ position: { x: 40, y: 360 } });
  await shown(page, '.mode-select-screen');
  await page.click('.mode-card[data-mode="raid"]');
  const wrap = page.locator('.raid-select-wrap:not([hidden])');
  await wrap.waitFor();
  await wrap.locator(`.raid-kaiju-seg .ui-seg-item[data-value="${kaiju}"]`).click();
  await wrap.locator('.raid-solo').click();
  await pickAssistPreset(page);
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight', null, {
    timeout: 180000,
  });
  await page.waitForFunction(() => window.__kshot !== undefined, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__kshot.elapsed() >= 1, null, {
    timeout: 10 * 60 * 1000,
    polling: 500,
  });
  // --scenes a,b / --weathers day で一部だけ（見た目の調整用）
  const pick = (name, all) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? '').split(',').filter((x) => all.includes(x)) : all;
  };
  const scenes = pick('--scenes', await page.evaluate(() => window.__kshot.scenes));
  const weathers = pick('--weathers', await page.evaluate(() => window.__kshot.weathers));
  const measureWeather = weathers[weathers.length - 1];
  console.log(`where: ${JSON.stringify(await page.evaluate(() => window.__kshot.where()))}`);
  const report = {};
  for (const w of weathers) {
    for (const s of scenes) {
      if (!noShots) {
        const url = await page.evaluate(([a, b]) => window.__kshot.shoot(a, b), [s, w]);
        if (!url.startsWith('data:image/webp')) throw new Error(`webp で書き出せなかった: ${s}`);
        const data = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        writeFileSync(`${OUT}${w}-${s}.webp`, data);
        console.log(`${kaiju}/${label}/${w}-${s}.webp (${(data.length / 1024).toFixed(0)} KB)`);
      }
      if (measure && w === measureWeather) {
        if (noShots) await page.evaluate(([a, b]) => window.__kshot.shoot(a, b), [s, w]);
        report[s] = await page.evaluate((a) => window.__kshot.measure(a), s);
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

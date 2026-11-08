/* global console, process, window, document, localStorage, Buffer, URL */
// 9-10d: レイドの怪獣選びの画像を、ゲームの描画で作る（`npm run render-kaiju-art [-- <怪獣の id>...] [--out <dir>]`）。
// 10-7f: 見た目の撮影（?dev=kshot・src/ui/kaiju-shot.ts）で撮る: 開発サーバーを立て、画質「高」でその怪獣のソロのレイドに出て、
// 怪獣を見せ場の場面の形に置き（src/data/<怪獣>-shots.ts の場面）、登録簿（src/data/raid-kaiju.ts の scene）の天候・カメラで
// 正方形に 1 枚撮る。見た目だけの乱数（Math.random）は決まった種にする（撮り直しても粒の出方が同じ）。
// 出力は public/kaiju-art/<id>.webp（960 × 960）。フォトモードで撮った写真に差し替えるときは README の「怪獣の画像」。
// 未公開の怪獣はその ?dev=<名前> を付けて開き、解放の条件は ?dev=kaiju-art のときは見ない。
// 構図を試すとき: `--scene '<JSON>'`（scene を上書き。1 体だけのとき）と `--out <dir>`（public/ に書かない）
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { pickBrowsers } from './audit-browsers.js';
import { pickAssistPreset, seed, shown } from './audit-helpers.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const free = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const OUT = opt('--out') ?? new URL('../public/kaiju-art/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sceneOverride = opt('--scene') ? JSON.parse(opt('--scene')) : null;

// ファイルを見張らない（撮っている間にソースを直しても読み直さない）
const server = await createServer({
  server: { port: 0, strictPort: false, hmr: false, watch: null },
  logLevel: 'warn',
});
await server.listen();
// 登録簿の怪獣（id・未公開の ?dev= の名前・場面）と書き出しの大きさ
const registry = await server.ssrLoadModule('/src/data/raid-kaiju.ts');
const { KAIJU_ART } = await server.ssrLoadModule('/src/data/kaiju-profiles.ts');
const ALL = registry.RAID_KAIJU.map((k) => k.id);
const defOf = new Map(registry.RAID_KAIJU.map((k) => [k.id, k]));
const ids = free.length > 0 ? ALL.filter((id) => free.includes(id)) : ALL;
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
// 描画はブラウザに任せる（クラウドの GPU の無い環境ではソフトウェアの描画。遅いが同じ絵になる）
const browser = await pickBrowsers('chromium')[0].launch();
try {
  for (const id of ids) {
    const def = defOf.get(id);
    const scene = { ...def.scene, ...(sceneOverride ?? {}) };
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
    await page.goto(base);
    await seed(page);
    // 画質は「高」（手動の設定として。自動で下げない）。セーブがあるとセーブの設定を読むのでそこへ書く
    await page.evaluate(() => {
      localStorage.setItem('skyraid.quality', 'high');
      const save = JSON.parse(localStorage.getItem('skyraid.save') ?? '{}');
      save.settings = { ...save.settings, quality: 'high' };
      localStorage.setItem('skyraid.save', JSON.stringify(save));
    });
    await page.goto(`${base}?dev=kshot,kaiju-art${def.dev ? `,${def.dev}` : ''}`);
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
      timeout: 180000,
    });
    await page.waitForFunction(() => window.__kshot !== undefined, null, { timeout: 180000 });
    await page.waitForFunction(() => window.__kshot.elapsed() >= 1, null, {
      timeout: 10 * 60 * 1000,
      polling: 500,
    });
    const image = { width: KAIJU_ART.size, height: KAIJU_ART.size, quality: KAIJU_ART.quality };
    const url = await page.evaluate(([v, i]) => window.__kshot.art(v, i), [scene, image]);
    if (!url.startsWith('data:image/webp'))
      throw new Error(`webp で書き出せなかった: ${url.slice(0, 30)}`);
    const data = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    writeFileSync(`${OUT}${id}.webp`, data);
    console.log(`${id}: ${OUT}${id}.webp (${(data.length / 1024).toFixed(0)} KB)`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

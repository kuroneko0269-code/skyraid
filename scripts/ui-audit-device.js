/* global console, process, document, window, localStorage, getComputedStyle, setTimeout */
// 実機確認の修正（8-6）の点検: 開発サーバーで、iPhone 横画面（844×390・タッチ）を模して確かめる。
// - tap: 少しずれたタップ（指が 8〜20px 動く）でも設定のタブ・モード選択のカード・セグメントが選ばれる。1 回のタップで
//   クリックは 1 回だけ。30px 動かしたとき・一覧をスクロールしたときは選ばない
// - viewport: canvas が画面の端まで（844×390）。iOS のように window.innerWidth / innerHeight が古い値でも、縦 → 横に
//   向きを変えた後も、描画バッファの縦横比が canvas と同じ
// - members: メンバー管理の行の高さが自分の行（ボタンなし）とほかの人の行でそろう
// - nozzle: 戦闘機 4 機種の排気と噴流（画質 3 × アフターバーナーの有無、横と斜め後ろ）を PNG に。噴流の後ろの黒い画素と
//   HalfFloat の描画先の NaN を数える（8-6b。scripts/ui-audit-device-nozzle.js）
// 使い方: `node scripts/ui-audit-device.js <出力先>`。結果は <出力先>/device.json と PNG
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { auditNozzles } from './ui-audit-device-nozzle.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] ?? 'device-audit';
mkdirSync(out, { recursive: true });

const VIEW = { width: 844, height: 390 };
const SAVE = {
  version: 9,
  pilotName: 'AUDIT',
  credits: 0,
  missions: {},
  aircraft: {
    selected: 'kestrel',
    owned: { kestrel: { engine: 0, airframe: 0, weapons: 0, avionics: 0 } },
  },
  settings: {},
  flags: { tutorialOffered: true },
};

async function touchContext(browser, viewport = VIEW) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await ctx.addInitScript((save) => {
    localStorage.setItem('skyraid.save', JSON.stringify(save));
  }, SAVE);
  return ctx;
}

async function toTitle(page, base) {
  await page.goto(base);
  await page.locator('.title-screen.is-shown').waitFor({ timeout: 90000 });
}

/** 指を置いて (dx, dy) 動かして離す（CDP のタッチ。続けて送り、実機のタップの速さにする） */
async function swipe(cdp, page, box, dx, dy) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cmds = [
    cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
  ];
  for (let i = 1; i <= 4; i++)
    cmds.push(
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 4, y: y + (dy * i) / 4 }],
      }),
    );
  cmds.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
  await Promise.all(cmds);
  await page.waitForTimeout(300);
}

/** クリックの回数を数える（数える受け口は 1 回だけ付け、呼ぶたびに 0 に戻す） */
const countClicks = (loc) =>
  loc.evaluate((e) => {
    e.dataset.auditClicks = '0';
    if (e.dataset.auditCounting) return;
    e.dataset.auditCounting = '1';
    e.addEventListener('click', () => {
      e.dataset.auditClicks = String(Number(e.dataset.auditClicks) + 1);
    });
  });

async function auditTap(browser, base) {
  const ctx = await touchContext(browser);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const rows = [];
  try {
    await toTitle(page, base);
    // 設定のタブ（固定の見出しの中）
    await page.locator('.title-settings').click();
    const tabs = page.locator('.settings-tabs .ui-seg-item');
    await tabs.first().waitFor();
    const last = tabs.nth((await tabs.count()) - 1);
    for (const [dx, dy, want] of [
      [0, 0, true],
      [6, 4, true],
      [12, 8, true],
      [16, 0, true],
      [0, 18, true],
      [20, 6, true],
      [30, 0, false],
    ]) {
      await tabs.nth(0).evaluate((e) => {
        e.click();
      });
      await countClicks(last);
      await swipe(cdp, page, await last.boundingBox(), dx, dy);
      const selected = (await last.getAttribute('aria-checked')) === 'true';
      const clicks = Number(await last.getAttribute('data-audit-clicks'));
      rows.push({
        what: `設定のタブ（${Math.round(Math.hypot(dx, dy))}px ずれ）`,
        ok: selected === want && clicks === (want ? 1 : 0),
        selected,
        clicks,
      });
    }
    // モード選択のカード → レイドのダイアログ → 難易度のセグメント
    await page.keyboard.press('Escape');
    await toTitle(page, base);
    await page.locator('.title-screen').click({ position: { x: 40, y: VIEW.height / 2 } });
    await page.locator('.mode-select-screen.is-shown').waitFor();
    const raid = page.locator('.mode-card[data-mode="raid"]');
    await swipe(cdp, page, await raid.boundingBox(), 14, 9);
    const dialog = page.locator('.mode-prompt:not([hidden])').first();
    const opened = await dialog.isVisible().catch(() => false);
    rows.push({ what: 'モード選択のカード（17px ずれ）', ok: opened, opened });
    if (opened) {
      const seg = dialog.locator('.ui-seg-item[aria-checked="false"]').first();
      const value = await seg.getAttribute('data-value');
      await swipe(cdp, page, await seg.boundingBox(), -15, 6);
      const now = await dialog
        .locator(`.ui-seg-item[data-value="${value}"]`)
        .getAttribute('aria-checked');
      rows.push({ what: 'ダイアログのセグメント（16px ずれ）', ok: now === 'true', value });
    }
    // スクロールできる一覧: 大きく動かしたらタップにしない（リプレイ一覧などと同じ。ここでは設定のデータのタブ）
    await page.keyboard.press('Escape');
    await toTitle(page, base);
    await page.locator('.title-settings').click();
    await tabs.first().waitFor();
    await last.evaluate((e) => {
      e.click();
    });
    const scrollButton = page.locator('.settings-tab[data-tab="data"] button:visible').first();
    await countClicks(scrollButton);
    await swipe(cdp, page, await scrollButton.boundingBox(), 0, -80);
    const clicks = Number(await scrollButton.getAttribute('data-audit-clicks'));
    rows.push({ what: '設定のデータ（80px ドラッグはタップにしない）', ok: clicks === 0, clicks });
  } finally {
    await ctx.close();
  }
  return rows;
}

const canvasState = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('#app > canvas');
    const r = c.getBoundingClientRect();
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      buffer: [c.width, c.height],
      inner: [window.innerWidth, window.innerHeight],
    };
  });

const fills = (s, view) =>
  s.rect[0] === 0 &&
  s.rect[1] === 0 &&
  s.rect[2] === view.width &&
  s.rect[3] === view.height &&
  Math.abs(s.buffer[0] / s.buffer[1] - view.width / view.height) < 0.01;

async function auditViewport(browser, base) {
  const rows = [];
  // 1. ふつうに横向きで起動
  let ctx = await touchContext(browser);
  let page = await ctx.newPage();
  await toTitle(page, base);
  let s = await canvasState(page);
  rows.push({ what: '横向きで起動', ok: fills(s, VIEW), ...s });
  await page.screenshot({ path: `${out}/viewport-landscape.png` });
  await ctx.close();
  // 2. iOS のように innerWidth / innerHeight が古い（小さい）値のまま（resize も来ない）
  ctx = await touchContext(browser);
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'innerWidth', { get: () => 600 });
    Object.defineProperty(window, 'innerHeight', { get: () => 280 });
  });
  page = await ctx.newPage();
  await toTitle(page, base);
  s = await canvasState(page);
  rows.push({ what: 'innerWidth / innerHeight が古い値（600×280）', ok: fills(s, VIEW), ...s });
  await page.screenshot({ path: `${out}/viewport-stale-inner.png` });
  await ctx.close();
  // 3. 縦で起動して横に向きを変える
  ctx = await touchContext(browser, { width: VIEW.height, height: VIEW.width });
  page = await ctx.newPage();
  await toTitle(page, base);
  await page.setViewportSize(VIEW);
  await page.waitForTimeout(1500);
  s = await canvasState(page);
  rows.push({ what: '縦で起動 → 横に回す', ok: fills(s, VIEW), ...s });
  await page.screenshot({ path: `${out}/viewport-rotated.png` });
  await ctx.close();
  return rows;
}

async function auditMembers(browser, base) {
  const ctx = await touchContext(browser);
  const page = await ctx.newPage();
  // アプリは起動させない（モジュールだけ読む）
  await page.route('**/src/main.ts', (r) =>
    r.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.goto(base);
  const heights = await page.evaluate(async () => {
    await import('/src/ui/theme.css');
    await import('/src/ui/settings.css');
    const i18n = await import('/src/core/i18n.ts');
    const table = await import('/src/data/i18n/ja.json');
    i18n.setMessages('ja', table.default);
    const { createMemberSettings } = await import('/src/ui/member-settings.ts');
    const rows = [
      { userId: 'u0', displayName: 'AUDIT', status: 'approved', requestedAt: null },
      {
        userId: 'u1',
        displayName: 'ALPHA',
        status: 'approved',
        requestedAt: '2026-10-01T00:00:00Z',
      },
      {
        userId: 'u2',
        displayName: 'BRAVO',
        status: 'pending',
        requestedAt: '2026-11-01T00:00:00Z',
      },
    ];
    const admin = {
      rows,
      load: () => Promise.resolve(rows),
      clear: () => undefined,
      renameSelf: () => false,
    };
    const panel = document.createElement('div');
    panel.className = 'settings-grid';
    // 設定の 2 列の 1 列（844×390 で約 344px）
    panel.style.width = '344px';
    panel.style.color = '#fff';
    document.body.appendChild(panel);
    const m = createMemberSettings(panel, admin, null);
    m.update({ owner: true, userId: 'u0' }, 'AUDIT');
    await new Promise((r) => setTimeout(r, 200));
    return [...document.querySelectorAll('.member-row')].map((r) => ({
      name: r.querySelector('.member-name')?.textContent ?? '',
      height: Math.round(r.getBoundingClientRect().height * 10) / 10,
      buttons: r.querySelectorAll('button').length,
      font: getComputedStyle(r).fontSize,
    }));
  });
  await page.locator('.member-settings').screenshot({ path: `${out}/members.png` });
  await ctx.close();
  const hs = heights.map((h) => h.height);
  return [{ what: 'メンバー管理の行の高さ', ok: Math.max(...hs) - Math.min(...hs) < 0.5, heights }];
}

const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls?.local[0] ?? 'http://localhost:5197/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = 0;
try {
  const result = {
    tap: await auditTap(browser, base),
    viewport: await auditViewport(browser, base),
    members: await auditMembers(browser, base),
    nozzle: await auditNozzles(browser, base, out),
  };
  writeFileSync(`${out}/device.json`, JSON.stringify(result, null, 2));
  for (const [group, rows] of Object.entries(result))
    for (const r of rows) {
      if (!r.ok) failed++;
      console.log(`${r.ok ? '✅' : '❌'} ${group}: ${r.what}`);
    }
} finally {
  await browser.close();
  await server.close();
}
process.exitCode = failed > 0 ? 1 : 0;

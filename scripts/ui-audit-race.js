/* global console, process, document, innerWidth, innerHeight, getComputedStyle */
// 9-8 リングレースの道案内の点検: 開発サーバーで 3 サイズ（568×320・844×390・1920×1080）× 言語（--lang ja|en）に、
// コース一覧（下見の切り替え）・コースの下見の画面・番号の札・上の帯の印（「次: ↑ 上へ」）・画面端の矢印と距離・通り損ねの行を撮り、
// 画面の外にはみ出していないか・文字が枠から切れていないか・札どうしが重なっていないかを見る。
// 夕空アクロバットを機首をまっすぐのまま飛ぶ（1・2 番を抜けると 3 番（真上向き）が「上へ」で画面の上の外 → 通り過ぎて通り損ね）
// 使い方: 開発サーバーを立ててから `node scripts/ui-audit-race.js <出力先> [URL] [--lang en]`。結果は <出力先>/race-guide.json と PNG
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AUDIT_LANG, CONTEXT_LOCALE, L } from './audit-lang.js';
import { seed, shown } from './audit-helpers.js';
import { inspect } from './audit-inspect.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const positional = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--lang');
const out = positional[0] ?? 'race-audit';
const base = positional[1] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });

const SIZES = [
  { name: 'phone-se', width: 568, height: 320, touch: true },
  { name: 'phone', width: 844, height: 390, touch: true },
  { name: 'pc', width: 1920, height: 1080, touch: false },
];

/** 見えている要素の枠が画面の中か・文字が切れていないか（selector に当たる全部） */
async function boxes(page, selector) {
  return page.evaluate((sel) => {
    const list = [];
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(e);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      list.push({
        text: (e.textContent ?? '').trim().slice(0, 80),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        inside:
          r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        clipped: e.scrollWidth > e.clientWidth + 1,
      });
    }
    return list;
  }, selector);
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const browser = await chromium.launch();
const results = [];
for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.touch,
    deviceScaleFactor: 1,
    locale: CONTEXT_LOCALE,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const r = { size: size.name, lang: AUDIT_LANG, steps: {}, issues: [] };
  const name = (step) => `${out}/race-${AUDIT_LANG}-${size.name}-${step}.png`;
  const check = async (step, selector) => {
    const list = await boxes(page, selector);
    r.steps[step] = list;
    for (const b of list) {
      if (!b.inside) r.issues.push({ step, kind: 'offscreen', target: b.text });
      if (b.clipped) r.issues.push({ step, kind: 'clip', target: b.text });
    }
    return list;
  };
  try {
    await page.goto(base);
    await seed(page);
    await page.goto(base);
    await shown(page, '.title-screen');
    await page.locator('.title-screen').click({ position: { x: 40, y: size.height / 2 } });
    await shown(page, '.mode-select-screen');
    await page.click('.mode-card[data-mode="race"]');
    await shown(page, '.race-screen');
    // 夕空アクロバット（4 番目）。初めてのコースは下見 ON
    await page.locator('.race-course').nth(3).click();
    await page.waitForTimeout(500);
    const sel = await page.evaluate(inspect, '.race-screen.is-shown');
    r.select = {
      issues: sel.issues,
      toggle: await page.locator('.race-preview-toggle').innerText(),
    };
    for (const i of sel.issues) r.issues.push({ step: 'select', ...i });
    await page.screenshot({ path: name('select') });
    await page.locator(`.ui-button.is-primary:text-is("${L('スタート')}"):visible`).click();
    // 下見の画面
    await page.locator('.race-preview:not([hidden])').waitFor();
    await page.waitForTimeout(2500);
    await check(
      'preview',
      '.race-preview-title, .race-preview-note, .race-preview-skip, .race-preview-label',
    );
    await page.screenshot({ path: name('preview') });
    // 下見の画面を押して飛ばす（描画の遅い大きさでは、撮る間に見終えていることがある）
    const pv = page.locator('.race-preview');
    if (await pv.isVisible()) await pv.click({ timeout: 10000 }).catch(() => undefined);
    await pv.waitFor({ state: 'hidden' });
    // 番号の札（カウントダウンの間。次 = 1 番・その次 = 2 番）
    await page.locator('.race-guide-badge:not([hidden])').first().waitFor();
    await page.waitForTimeout(800);
    const badges = await check('badges', '.race-guide-badge:not([hidden])');
    if (badges.length === 2 && overlaps(badges[0], badges[1]))
      r.issues.push({
        step: 'badges',
        kind: 'overlap',
        target: `${badges[0].text} / ${badges[1].text}`,
      });
    await page.screenshot({ path: name('badges') });
    // 「次: ↑ 上へ」と画面端の矢印・距離（3 番は真上）
    await page.locator('.race-guide-row.is-cue:not([hidden])').waitFor({ timeout: 120000 });
    await page
      .locator('.mission-waypoint-arrow-text:not([hidden])')
      .waitFor({ timeout: 60000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    await check(
      'cue',
      '.race-guide-row.is-cue, .mission-waypoint-arrow-text:not([hidden]), .race-top',
    );
    await page.screenshot({ path: name('cue') });
    // 通り損ね（3 番の下を通り過ぎる）
    await page.locator('.race-guide-row.is-missed:not([hidden])').waitFor({ timeout: 120000 });
    await page.waitForTimeout(300);
    await check(
      'missed',
      '.race-guide-row.is-missed, .mission-waypoint-arrow-text:not([hidden]), .race-top',
    );
    r.alert = await page
      .locator('.mission-waypoint-arrow.is-alert, .mission-waypoint.is-alert')
      .count();
    await page.screenshot({ path: name('missed') });
  } catch (e) {
    r.issues.push({ kind: 'exception', target: String(e).slice(0, 200) });
    await page.screenshot({ path: name('error') }).catch(() => undefined);
  }
  r.errors = errors;
  results.push(r);
  console.log(`${size.name} ${AUDIT_LANG}: 問題 ${r.issues.length}・エラー ${errors.length}`);
  for (const i of r.issues) console.log(`  ${i.step ?? ''} ${i.kind} ${i.target ?? ''}`);
  await context.close();
}
await browser.close();
writeFileSync(`${out}/race-guide-${AUDIT_LANG}.json`, JSON.stringify(results, null, 2));

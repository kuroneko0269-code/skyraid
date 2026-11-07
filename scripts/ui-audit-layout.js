/* global console, document, innerHeight, innerWidth, process, getComputedStyle */
// 画面の配置の点検（9-9c）: 記録カードの画面・リプレイの一覧（見本の記録 14 本）・練習場の結果（9-10d: レイドの怪獣選び・ロビーの
// 部屋の画面も）を 844×390・568×320 で開き、
// 主な要素の位置と大きさ・縦にスクロールする入れ物を測って PNG を撮る（変更の前後の比べ用）。
// 使い方: 開発サーバーを立ててから `node scripts/ui-audit-layout.js <出力先> [URL] [--lang en]`（結果は <出力先>/layout.json）
import { CONTEXT_LOCALE } from './audit-lang.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pickBrowsers } from './audit-browsers.js';
import { seed, shown, throttleMenuFrames } from './audit-helpers.js';
import { openReplaySample } from './audit-samples.js';
import { openCardSample, openLobbySample, openPracticeResultSample } from './ui-audit-screens.js';

const argv = process.argv.slice(2);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang');
const out = positional[0] ?? 'ui-audit-layout';
const base = positional[1] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const SIZES = [
  { name: 'phone', width: 844, height: 390 },
  { name: 'phone-se', width: 568, height: 320 },
];

/** 主な要素の位置と大きさ、縦にスクロールする入れ物 */
function measure(selectors) {
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const items = {};
  for (const [name, sel] of Object.entries(selectors)) {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length > 0);
    items[name] = e ? box(e) : null;
  }
  const scrollers = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (e.getClientRects().length === 0 || e.closest('[hidden]')) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || (s.overflowY !== 'auto' && s.overflowY !== 'scroll')) continue;
    const over = e.scrollHeight - e.clientHeight;
    if (over > 1)
      scrollers.push({
        target: `${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 2).join('.')}`,
        client: e.clientHeight,
        over,
      });
  }
  return { viewport: { w: innerWidth, h: innerHeight }, items, scrollers };
}

const CASES = [
  {
    name: 'card',
    open: openCardSample,
    root: '.card-overlay',
    selectors: {
      dialog: '.card-dialog',
      preview: '.card-preview',
      pilot: '.card-pilot',
      note: '.card-note',
      text: '.card-text',
      buttons: '.card-buttons',
    },
  },
  {
    name: 'replay',
    open: openReplaySample,
    root: '.replay-screen.is-shown',
    selectors: {
      heading: '.replay-screen.is-shown .campaign-heading',
      list: '.replay-screen.is-shown .replay-list',
      entry: '.replay-screen.is-shown .replay-entry',
      detail: '.replay-screen.is-shown .replay-detail',
      buttons: '.replay-screen.is-shown .campaign-buttons',
    },
    /** 一覧の中で全部見えている行の数 */
    extra: () => {
      const list = document.querySelector('.replay-screen.is-shown .replay-list');
      if (!list) return null;
      const lr = list.getBoundingClientRect();
      const top = Math.max(lr.top, 0);
      const bottom = Math.min(lr.bottom, innerHeight);
      const rows = [...list.querySelectorAll('.replay-entry')];
      return {
        visibleRows: rows.filter((r) => {
          const b = r.getBoundingClientRect();
          return b.top >= top - 1 && b.bottom <= bottom + 1;
        }).length,
        rows: rows.length,
      };
    },
  },
  {
    name: 'practice-result',
    open: openPracticeResultSample,
    root: '.practice-result-screen.is-shown',
    selectors: {
      panel: '.practice-result-screen.is-shown .campaign-panel',
      score: '.practice-result-screen.is-shown .practice-result-score',
      tabs: '.practice-result-screen.is-shown .practice-tabs',
      advice: '.practice-result-screen.is-shown .practice-advice',
      facts: '.practice-result-screen.is-shown .campaign-facts',
      settings: '.practice-result-screen.is-shown .practice-settings',
      buttons: '.practice-result-screen.is-shown .campaign-buttons',
    },
    tabs: ['stats', 'settings'],
  },
];

/** モード選択から開く画面（9-9c: 項目 4 で直した画面） */
const viaModeSelect = (sel) => async (page) => {
  await page.locator('.title-screen').click({ position: { x: 40, y: 150 } });
  await shown(page, '.mode-select-screen');
  await page.click(sel);
};
CASES.push(
  {
    name: 'race',
    open: viaModeSelect('.mode-card[data-mode="race"]'),
    root: '.race-screen.is-shown',
    selectors: {
      list: '.race-select .race-course-list',
      detail: '.race-select .race-detail',
      buttons: '.race-select .campaign-buttons',
    },
    tabs: ['records', 'aircraft'],
  },
  // 9-10d: レイドの怪獣選び（ネフィルガ・高難度も）
  {
    name: 'raid',
    open: viaModeSelect('.mode-card[data-mode="raid"]'),
    root: '.raid-select-wrap:not([hidden])',
    selectors: {
      art: '.raid-select .raid-art',
      info: '.raid-select .raid-info',
      attacks: '.raid-select .raid-attacks',
      difficulty: '.raid-select .raid-difficulty',
      actions: '.raid-select .raid-actions',
    },
    tabs: ['nephirga', 'albion', 'hard'],
  },
  {
    name: 'hangar',
    open: viaModeSelect('.mode-tile[data-mode="hangar"]'),
    root: '.hangar-screen',
    selectors: { panel: '.hangar-screen .hangar-detail' },
    tabs: ['upgrades'],
  },
);
// 9-10d: ロビーの部屋の画面（見本。ホスト・参加者・チーム戦・協力レイド・協力防衛戦）
for (const variant of ['host-ffa', 'guest-ffa', 'host-team', 'host-raid', 'guest-defense'])
  CASES.push({
    name: `lobby-${variant}`,
    open: async (page) => {
      await page.locator('.title-screen').click({ position: { x: 40, y: 150 } });
      await shown(page, '.mode-select-screen');
      await openLobbySample(page, variant);
    },
    root: '.lobby-screen.is-shown',
    selectors: {
      top: '.lobby-screen.is-shown .lobby-top',
      code: '.lobby-screen.is-shown .lobby-code',
      seats: '.lobby-screen.is-shown .lobby-seat-list',
      config: '.lobby-screen.is-shown .lobby-config',
      bottom: '.lobby-screen.is-shown .lobby-bottom',
      main: '.lobby-screen.is-shown .lobby-main:not([hidden])',
    },
    tabs: variant === 'host-ffa' || variant === 'guest-defense' ? ['options'] : [],
  });
if (process.env.ONLY)
  CASES.splice(
    0,
    CASES.length,
    ...CASES.filter((c) => process.env.ONLY.split(',').includes(c.name)),
  );

const results = [];
const browser = await pickBrowsers('chromium')[0].launch();
for (const size of SIZES) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: 1,
    locale: CONTEXT_LOCALE,
  });
  await throttleMenuFrames(context);
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  // 名前入力済みのセーブ（タイトル → モード選択）
  await page.goto(base);
  await seed(page);
  for (const c of CASES) {
    await page.goto(base);
    await shown(page, '.title-screen');
    await c.open(page);
    await page.waitForTimeout(800);
    const shots = [{ tab: null }, ...(c.tabs ?? []).map((tab) => ({ tab }))];
    for (const { tab } of shots) {
      if (tab) {
        const b = page
          .locator(
            `${c.root} .practice-tab[data-tab="${tab}"], ${c.root} .ui-seg-item[data-value="${tab}"]`,
          )
          .first();
        if (!(await b.count())) continue;
        await b.click();
        await page.waitForTimeout(300);
      }
      const name = tab ? `${c.name}-${tab}` : c.name;
      const r = await page.evaluate(measure, c.selectors);
      if (c.extra) r.extra = await page.evaluate(c.extra);
      results.push({ size: size.name, screen: name, ...r });
      await page.screenshot({ path: `${out}/${size.name}-${name}.png` });
      console.log(`${size.name}\t${name}\t${JSON.stringify(r.items)}`);
      if (r.extra) console.log(`    ${JSON.stringify(r.extra)}`);
      for (const s of r.scrollers)
        console.log(`    scroll: ${s.target} (+${s.over}px / ${s.client}px)`);
    }
  }
  await context.close();
}
await browser.close();
writeFileSync(`${out}/layout.json`, JSON.stringify(results, null, 2));

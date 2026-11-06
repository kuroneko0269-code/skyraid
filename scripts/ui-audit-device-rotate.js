/* global document, window, Element, VisualViewport, ScreenOrientation, Screen, Event, getComputedStyle */
// 回転の後のレイアウトの点検（9-9b。node scripts/ui-audit-device.js <出力先> --only rotate）。
// 844×390 で各画面を開いて要素の枠を測り、次の 2 つの後に測り直して最初と同じ配置か（1px 以内）を見る。
// 9-9c: 対象を src/ui の全部の画面とダイアログに（scripts/rotate-coverage.js がソースから拾う）。9-9b は対象を手で並べていて、
// モード選択のカードから開く 1 枚目だけを測っていた（チュートリアルの章の一覧・補助の組・結果の画面・タブの先・ダイアログは
// 測っていなかった）。開き方の分かる画面は開いて、残りは表示を強めて測り、DOM に無い画面は失敗にする:
// - rotate: 縦（390×844）にしてから横（844×390）に戻す（Chromium は値がすぐ正しくなる）
// - stale: iOS で縦 → 横に戻した直後を模す。@media の基準（初期包含ブロック。ここではブラウザの大きさ）は縦の高さの
//   まま（844×844）、inner・visualViewport は正しい 844×390、documentElement.clientWidth / clientHeight は縦の古い値
//   （390×844）。8-6d までは client の 844 を screen の短辺 390 に切り詰め、配置は @media で縦向きのまま（カードが
//   大きくなってスクロールが要る）になった
const FAKE = () => {
  // 点検から window.__fakeVp = { innerWidth, innerHeight, clientWidth, clientHeight, landscape } で値を差し替える
  const over = (proto, prop, pick) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d?.get) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      get() {
        const v = window.__fakeVp ? pick(this, window.__fakeVp) : undefined;
        return v === undefined ? d.get.call(this) : v;
      },
    });
  };
  for (const prop of ['innerWidth', 'innerHeight']) {
    const d = Object.getOwnPropertyDescriptor(window, prop);
    if (!d?.get) continue;
    Object.defineProperty(window, prop, {
      configurable: true,
      get() {
        return window.__fakeVp?.[prop] ?? d.get.call(window);
      },
    });
  }
  over(Element.prototype, 'clientWidth', (el, f) =>
    el === document.documentElement ? f.clientWidth : undefined,
  );
  over(Element.prototype, 'clientHeight', (el, f) =>
    el === document.documentElement ? f.clientHeight : undefined,
  );
  over(VisualViewport.prototype, 'width', (_, f) => f.innerWidth);
  over(VisualViewport.prototype, 'height', (_, f) => f.innerHeight);
  over(ScreenOrientation.prototype, 'type', (_, f) =>
    f.landscape ? 'landscape-primary' : 'portrait-primary',
  );
  over(Screen.prototype, 'width', () => 390);
  over(Screen.prototype, 'height', () => 844);
};

import { coveredIn, forceShow, uiRoots } from './rotate-coverage.js';
import { buildOverlaySamples, openReplaySample } from './audit-samples.js';
import {
  openCardSample,
  openFailedResultSample,
  openPracticeResultSample,
} from './ui-audit-screens.js';

/** 出ている画面（ダイアログが開いていればダイアログ）の中の要素の枠 */
const layout = (page, root) =>
  page.evaluate((rootSel) => {
    const dialog = document.querySelector('.mode-prompt:not([hidden])');
    const screen =
      (rootSel ? document.querySelector(rootSel) : null) ??
      dialog ??
      [...document.querySelectorAll('.screen.is-shown')].pop() ??
      document.querySelector('.hud');
    if (!screen) return { name: 'none', rects: [], scroll: [] };
    const rects = [];
    const scroll = [];
    for (const el of [screen, ...screen.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push([
        Math.round(r.left),
        Math.round(r.top),
        Math.round(r.width),
        Math.round(r.height),
      ]);
      if (
        el.scrollHeight > el.clientHeight + 1 &&
        /(auto|scroll)/.test(getComputedStyle(el).overflowY)
      )
        scroll.push(el.scrollHeight - el.clientHeight);
      if (rects.length >= 600) break;
    }
    return { name: screen.className, rects, scroll };
  }, root ?? null);

/** 2 つの配置の違い（ずれた要素の数・最大のずれ・スクロールの量の変化） */
function diff(a, b) {
  let moved = 0;
  let max = 0;
  const which = [];
  const n = Math.max(a.rects.length, b.rects.length);
  for (let i = 0; i < n; i++) {
    const p = a.rects[i];
    const q = b.rects[i];
    if (!p || !q) {
      moved++;
      continue;
    }
    const d = Math.max(...p.slice(0, 4).map((v, k) => Math.abs(v - (q[k] ?? 0))));
    if (d > 1) {
      moved++;
      if (which.length < 5)
        which.push(`${p[4]} ${p.slice(0, 4).join(',')} → ${q.slice(0, 4).join(',')}`);
    }
    max = Math.max(max, d);
  }
  return { moved, max, count: n, which, scroll: [a.scroll.join(','), b.scroll.join(',')] };
}

export async function auditRotate({ browser, base, touchContext, toTitle, view }) {
  const keys = uiRoots().map((r) => r.classes);
  const covered = new Set();
  const ctx = await touchContext(browser);
  await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const rows = [];
  const settle = (ms) => page.waitForTimeout(ms);
  const toModes = async () => {
    await toTitle(page, base);
    await page.locator('.title-screen').click({ position: { x: 40, y: view.height / 2 } });
    await page.locator('.mode-select-screen.is-shown').waitFor();
  };
  /** 出ているダイアログ（無ければモード選択以外の画面）に印を付けて、そのセレクタ */
  const markOpened = () =>
    page.evaluate(() => {
      for (const e of document.querySelectorAll('[data-rotate-target]'))
        delete e.dataset.rotateTarget;
      const dialog = [...document.querySelectorAll('.mode-prompt:not([hidden])')].pop();
      const screen = [...document.querySelectorAll('.screen.is-shown')]
        .filter((s) => !s.classList.contains('mode-select-screen'))
        .pop();
      const el = dialog ?? screen;
      if (!el) return null;
      el.dataset.rotateTarget = '1';
      return '[data-rotate-target="1"]';
    });
  /** 開いた画面で、回転の 2 通りの後も同じ配置か（root は測る要素のセレクタ） */
  const check = async (what, root) => {
    // 開いた直後の動き（ハンガーの性能のバーが伸びるなど）が終わってから
    await settle(2500);
    for (const k of await page.evaluate(coveredIn, { rootSelector: root, keys })) covered.add(k);
    const first = await layout(page, root);
    // rotate: 縦にして横に戻す
    await page.setViewportSize({ width: view.height, height: view.width });
    await settle(900);
    await page.setViewportSize(view);
    await settle(1500);
    const rotated = diff(first, await layout(page, root));
    rows.push({
      what: `回転（縦 → 横）の後も同じ配置: ${what}`,
      ok: rotated.count > 0 && rotated.moved === 0 && rotated.scroll[0] === rotated.scroll[1],
      ...rotated,
    });
    // stale: iOS の縦 → 横の直後（@media の基準は縦の高さのまま・client は縦の古い値）
    await page.setViewportSize({ width: view.width, height: view.width });
    await page.evaluate(
      ([w, h]) => {
        window.__fakeVp = {
          innerWidth: w,
          innerHeight: h,
          clientWidth: h,
          clientHeight: w,
          landscape: true,
        };
        window.dispatchEvent(new Event('resize'));
      },
      [view.width, view.height],
    );
    await settle(1500);
    const stale = diff(first, await layout(page, root));
    rows.push({
      what: `iOS の古い値を模した回転の後も同じ配置: ${what}`,
      ok: stale.count > 0 && stale.moved === 0 && stale.scroll[0] === stale.scroll[1],
      ...stale,
    });
    await page.evaluate(() => {
      window.__fakeVp = undefined;
    });
    await page.setViewportSize(view);
    await settle(900);
  };
  /** モード選択のカード・タイルから開いて測る。開けなければ（ランキングは連携のときだけ）false */
  const openMode = async (mode) => {
    await toModes();
    if (!(await page.locator(`[data-mode="${mode}"]`).isVisible())) return null;
    await page.click(`[data-mode="${mode}"]`);
    await page.waitForFunction(
      () =>
        document.querySelector('.mode-prompt:not([hidden])') !== null ||
        document.querySelector('.screen.is-shown:not(.mode-select-screen)') !== null,
    );
    await settle(600);
    return markOpened();
  };
  /** 開いた画面のタブ（セレクタ）を順に押して測る */
  const tabs = async (what, root, selector) => {
    const n = await page.locator(selector).count();
    for (let i = 1; i < n; i++) {
      const tab = page.locator(selector).nth(i);
      const label = (await tab.textContent())?.trim() ?? String(i);
      await tab.click();
      await check(`${what}（${label}）`, root);
    }
  };

  await toTitle(page, base);
  await check('タイトル', '.title-screen');
  await toModes();
  await check('モード選択', '.mode-select-screen');
  const TABS = {
    practice: '.practice-screen .practice-tab',
    race: '.race-select .practice-tab',
    hangar: '.hangar-tabs .ui-seg-item',
    settings: '.settings-tabs .ui-seg-item',
    info: '.info-tabs .ui-seg-item',
  };
  for (const mode of [
    'daily',
    'tutorial',
    'campaign',
    'practice',
    'race',
    'free',
    'raid',
    'defense',
    'pvp',
    'hangar',
    'replay',
    'ranking',
    'badges',
    'settings',
    'info',
  ]) {
    const root = await openMode(mode);
    if (!root) continue;
    await check(mode, root);
    if (TABS[mode]) await tabs(mode, root, TABS[mode]);
  }
  // チュートリアル: 章の一覧の後に、補助の章の頁（章のボタンの最後）
  if (await openMode('tutorial')) {
    await page.locator('.tutorial-chapter').last().click();
    await page.locator('.tutorial-page:not([hidden])').waitFor();
    await check('チュートリアル（補助の章の頁）', '.tutorial-list');
  }
  // キャンペーン: ブリーフィング
  if (await openMode('campaign')) {
    await page.locator('.mission-entry').first().click();
    await page.locator('.briefing-screen.is-shown').waitFor();
    await check('ブリーフィング', '.briefing-screen');
  }
  // 見本で出す画面（飛ばずに）: リプレイの一覧（14 本）・練習場の結果（タブ）・キャンペーンの結果・記録カード
  const samples = [
    ['リプレイの一覧（14 本）', openReplaySample, '.replay-screen.is-shown'],
    ['練習場の結果', openPracticeResultSample, '.practice-result-screen.is-shown'],
    [
      'キャンペーンの結果',
      openFailedResultSample,
      '.result-screen.is-shown:not(.practice-result-screen)',
    ],
    ['記録カード', openCardSample, '.card-overlay'],
  ];
  for (const [what, open, root] of samples) {
    await toModes();
    await open(page);
    await check(what, root);
    if (what === '練習場の結果') await tabs(what, root, `${root} .practice-tab`);
  }
  // 飛行: ポーズ・タッチ操作のボタン（HUD は飛ぶと動くので、タッチ操作のボタンの配置を見る）
  await toModes();
  await page.click('[data-mode="free"]');
  await page.locator('.mode-prompt:not([hidden]) .ui-button.is-primary').first().click();
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight');
  await settle(3000);
  await check('飛行（タッチ操作のボタン）', '.touch-controls');
  await page.keyboard.press('Escape');
  await page.locator('.pause-screen.is-shown').waitFor();
  await check('ポーズ', '.pause-screen');

  // 開き方を並べていない画面・ダイアログ（src/ui のソースから拾った残り）: 表示を強めて測る。DOM に無ければ失敗
  const opened = covered.size;
  for (const key of keys.filter((k) => !covered.has(k))) {
    await toModes();
    await buildOverlaySamples(page);
    const root = await page.evaluate(forceShow, { key, keys });
    if (!root) {
      rows.push({
        what: `点検していない（DOM に無い。開き方を ui-audit-device-rotate.js に足す）: ${key}`,
        ok: false,
      });
      continue;
    }
    await check(`表示を強めて: ${key}`, root);
  }
  rows.push({
    what: `src/ui の画面・ダイアログ ${keys.length} 組: 開いて測った ${opened}・表示を強めて測った ${covered.size - opened}`,
    ok: covered.size === keys.length,
    covered: [...covered],
  });
  await ctx.close();
  return rows;
}

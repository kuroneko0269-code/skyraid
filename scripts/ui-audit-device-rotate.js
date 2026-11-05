/* global document, window, Element, VisualViewport, ScreenOrientation, Screen, Event, getComputedStyle */
// 回転の後のレイアウトの点検（9-9b。node scripts/ui-audit-device.js <出力先> --only rotate）。
// 844×390 で各画面を開いて要素の枠を測り、次の 2 つの後に測り直して最初と同じ配置か（1px 以内）を見る:
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
  /** 開いた画面で、回転の 2 通りの後も同じ配置か */
  const check = async (what, root) => {
    // 開いた直後の動き（ハンガーの性能のバーが伸びるなど）が終わってから
    await settle(2500);
    const first = await layout(page, root);
    // rotate: 縦にして横に戻す
    await page.setViewportSize({ width: view.height, height: view.width });
    await settle(900);
    await page.setViewportSize(view);
    await settle(1500);
    const rotated = diff(first, await layout(page, root));
    rows.push({
      what: `回転（縦 → 横）の後も同じ配置: ${what}`,
      ok: rotated.moved === 0 && rotated.scroll[0] === rotated.scroll[1],
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
      ok: stale.moved === 0 && stale.scroll[0] === stale.scroll[1],
      ...stale,
    });
    await page.evaluate(() => {
      window.__fakeVp = undefined;
    });
    await page.setViewportSize(view);
    await settle(900);
  };

  await toTitle(page, base);
  await check('タイトル');
  await page.locator('.title-screen').click({ position: { x: 40, y: view.height / 2 } });
  await page.locator('.mode-select-screen.is-shown').waitFor();
  await check('モード選択');
  const modes = [
    'daily',
    'tutorial',
    'campaign',
    'practice',
    'race',
    'free',
    'raid',
    'defense',
    'hangar',
    'replay',
    'ranking',
    'badges',
    'settings',
    'info',
  ];
  for (const mode of modes) {
    await toModes();
    // ランキングはオンライン連携のときだけ出る
    if (!(await page.locator(`[data-mode="${mode}"]`).isVisible())) continue;
    await page.click(`[data-mode="${mode}"]`);
    await page.waitForFunction(
      () =>
        document.querySelector('.mode-prompt:not([hidden])') !== null ||
        document.querySelector('.screen.is-shown:not(.mode-select-screen)') !== null,
    );
    await check(mode);
  }
  // 飛行の HUD（フリーフライト）
  await toModes();
  await page.click('[data-mode="free"]');
  await page.locator('.mode-prompt:not([hidden]) .ui-button.is-primary').first().click();
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight');
  await settle(3000);
  // HUD は飛ぶと動くので、タッチ操作のボタンの配置を見る
  await check('飛行（タッチ操作のボタン）', '.touch-controls');
  await ctx.close();
  return rows;
}

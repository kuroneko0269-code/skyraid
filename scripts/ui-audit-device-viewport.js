/* global document, window, Navigator, Element */
// 実機確認の修正の点検（scripts/ui-audit-device.js）のうち、画面の大きさ（8-6）と画面の大きさの表示（8-6d）
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

export async function auditViewport({ browser, base, out, view: VIEW, touchContext, toTitle }) {
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
  // 2b. 8-6d: iOS のホーム画面から起動（navigator.standalone）で、inner・client・visualViewport がどれも小さい値（844×343）のまま
  //     → screen の大きさ（844×390）を下限にして body・canvas が画面の端まで
  ctx = await touchContext(browser);
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
    Object.defineProperty(window, 'innerHeight', { get: () => 343 });
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight').get;
    Object.defineProperty(Element.prototype, 'clientHeight', {
      get() {
        return this === document.documentElement ? 343 : clientHeight.call(this);
      },
    });
    if (window.visualViewport)
      Object.defineProperty(window.visualViewport, 'height', { get: () => 343 });
  });
  page = await ctx.newPage();
  await toTitle(page, base);
  s = await canvasState(page);
  rows.push({
    what: 'ホーム画面から起動・inner / client が小さい値（844×343）',
    ok: fills(s, VIEW),
    ...s,
  });
  await page.screenshot({ path: `${out}/viewport-standalone-stale.png` });
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

/** 8-6d: 画面の大きさの表示（?debug=viewport・タイトルの版の表示を 5 回押す。押すと出て、読み直しても残り、もう 5 回で消える） */
export async function auditViewportDebug({ browser, base, out, touchContext, toTitle }) {
  const rows = [];
  let ctx = await touchContext(browser);
  let page = await ctx.newPage();
  await toTitle(page, `${base}?debug=viewport`);
  const shown = () =>
    page
      .locator('.viewport-debug')
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
  let on = await shown();
  const text = on ? await page.locator('.viewport-debug').textContent() : '';
  rows.push({
    what: '?debug=viewport で左上に値が出る（fps の表示は出ない）',
    ok:
      on &&
      /inner\s+844x390/.test(text) &&
      (await page.locator('.debug-overlay:visible').count()) === 0,
    text: text.split('\n').slice(0, 14),
  });
  await page.screenshot({ path: `${out}/viewport-debug.png` });
  await ctx.close();
  ctx = await touchContext(browser);
  page = await ctx.newPage();
  await toTitle(page, base);
  const tapVersion = async () => {
    for (let i = 0; i < 5; i++) await page.locator('.title-version').click();
  };
  await tapVersion();
  on = await shown();
  const stillTitle = await page.locator('.title-screen.is-shown').isVisible();
  await page.reload();
  await page.locator('.title-screen.is-shown').waitFor({ timeout: 90000 });
  const kept = await shown();
  await tapVersion();
  await page.waitForTimeout(300);
  const off = (await page.locator('.viewport-debug').count()) === 0;
  rows.push({
    what: '版の表示を 5 回押すと出る（タイトルのまま）・読み直しても残る・もう 5 回で消える',
    ok: on && stillTitle && kept && off,
    on,
    stillTitle,
    kept,
    off,
  });
  await ctx.close();
  return rows;
}

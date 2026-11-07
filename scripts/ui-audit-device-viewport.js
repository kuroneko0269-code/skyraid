/* global window */
// 実機確認の修正の点検（scripts/ui-audit-device.js）のうち、画面の大きさ（8-6）と画面の大きさの表示（8-6d）
import { canvasState, standaloneShort } from './ui-audit-device-standalone.js';
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
  // 2b. 8-6d / 8-6e: iOS のホーム画面から起動（navigator.standalone）で、inner・client・visualViewport がどれも小さい値（844×343）のまま
  //     → 8-6e: iOS は 343 より下を描かないので、body・canvas は 844×343 に合わせる（下端の UI を描かれる範囲に）。
  //     viewport-fit を切り替える試み（nudge）が記録に残る
  rows.push(
    await standaloneShort({
      browser,
      base,
      out,
      VIEW,
      touchContext,
      toTitle,
      late: false,
      what: 'ホーム画面から起動・inner / client が小さい値（844×343）→ 描かれる 844×343 に合わせ、測り直しを試す（その間は黒い幕・中央にロゴ）',
      shot: 'viewport-standalone-stale',
    }),
  );
  // 2c. v1.0.1: v1.0.0 の実機の起動。最初は縦の値（390×800・portrait）で、少し後（値を最初に読んでから 1.5 秒。8-6f の 0.6 秒の判定より後）に
  //     横の短い値（844×343）になる。8-6f / 8-7 はこの起動で幕も試みも出さず、下の黒い余白が残った（2b は最初から横の短い値なので見逃した）
  rows.push(
    await standaloneShort({
      browser,
      base,
      out,
      VIEW,
      touchContext,
      toTitle,
      late: true,
      what: 'v1.0.1: ホーム画面から起動・最初は縦の値で 1.5 秒後に横の短い値（844×343）→ その時に幕（中央にロゴ）を出して測り直しを試し、外す',
      shot: 'viewport-standalone-late',
    }),
  );
  // 2d. v1.0.1: 幕のロゴが読めなくても、測り直しと幕の外しは止まらない（ロゴの代わりに「SkyRaid」の文字）
  rows.push(
    await standaloneShort({
      browser,
      base,
      out,
      VIEW,
      touchContext,
      toTitle,
      late: true,
      failLogo: true,
      what: 'v1.0.1: 同じ起動で幕のロゴが読めない（404）→ 文字にして、測り直しと幕の外しは止まらない',
      shot: 'viewport-standalone-nologo',
    }),
  );
  // 2e. 10-1c: 動作を減らす設定（prefers-reduced-motion）では、揺れ・乱れを出さずにその場で明ける
  rows.push(
    await standaloneShort({
      browser,
      base,
      out,
      VIEW,
      touchContext,
      toTitle,
      late: true,
      reduced: true,
      what: '10-1c: 同じ起動で「動作を減らす」の設定 → ロゴは揺れも乱れもせず、移らずにその場で幕を明ける',
      shot: 'viewport-standalone-reduced',
    }),
  );
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

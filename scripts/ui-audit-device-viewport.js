/* global document, window, Navigator, Element, Event, ScreenOrientation, performance */
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

/**
 * iOS のホーム画面から起動して描かれる高さが足りない（844×343）ときの点検。late なら最初は縦の値で、値を最初に読んでから 1.5 秒後に
 * 横の短い値になる（v1.0.0 の実機の起動）。failLogo なら幕のロゴを 404 にする
 */
async function standaloneShort({
  browser,
  base,
  out,
  VIEW,
  touchContext,
  toTitle,
  late,
  failLogo,
  what,
  shot,
}) {
  const ctx = await touchContext(browser);
  if (failLogo) await ctx.route(/\/brand\/logo\.png/, (r) => r.fulfill({ status: 404, body: '' }));
  await ctx.addInitScript((late) => {
    Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true });
    // late: 最初に値を読んだ時刻から 1.5 秒は縦（390×800）。その後は横の短い値（844×343）にして resize を送る
    let rotated = !late;
    let first = 0;
    const mark = () => {
      if (rotated || first) return;
      first = performance.now();
      window.setTimeout(() => {
        rotated = true;
        window.dispatchEvent(new Event('resize'));
      }, 1500);
    };
    const pick = (portrait, landscape) => {
      mark();
      return rotated ? landscape : portrait;
    };
    const innerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')?.get;
    Object.defineProperty(window, 'innerWidth', {
      get: () => pick(390, innerWidth ? innerWidth.call(window) : 844),
    });
    Object.defineProperty(window, 'innerHeight', { get: () => pick(800, 343) });
    const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth').get;
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight').get;
    Object.defineProperty(Element.prototype, 'clientWidth', {
      get() {
        return this === document.documentElement
          ? pick(390, clientWidth.call(this))
          : clientWidth.call(this);
      },
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      get() {
        return this === document.documentElement ? pick(800, 343) : clientHeight.call(this);
      },
    });
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const vvWidth = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), 'width').get;
      Object.defineProperty(vv, 'width', { get: () => pick(390, vvWidth.call(vv)) });
      Object.defineProperty(vv, 'height', { get: () => pick(800, 343) });
    }
    if (window.ScreenOrientation) {
      const type = Object.getOwnPropertyDescriptor(ScreenOrientation.prototype, 'type').get;
      Object.defineProperty(ScreenOrientation.prototype, 'type', {
        get() {
          return pick('portrait-primary', type.call(this));
        },
      });
    }
    // 8-7: 幕の中央にロゴが出たか（幕は数秒で外れるので、出ている間に見ておく）。v1.0.1: 文字になったかも
    const watch = window.setInterval(() => {
      const logo = document.querySelector('.viewport-cover-logo.is-loaded');
      const text = document.querySelector('.viewport-cover.is-text .viewport-cover-text');
      const shown = logo ?? text;
      if (shown) {
        const r = shown.getBoundingClientRect();
        window.__coverLogo = {
          kind: logo ? 'logo' : 'text',
          width: Math.round(r.width),
          centerX: Math.round(r.x + r.width / 2),
        };
        window.clearInterval(watch);
      }
    }, 50);
  }, late);
  const page = await ctx.newPage();
  await toTitle(page, base);
  // 試みが終わって幕が外れるまで待つ（SwiftShader は起動が重く、タイマーが遅れる）。v1.0.1: 記録は viewport-log.ts の startupEvents
  const history = () =>
    page.evaluate(async () => {
      const m = await import('/src/core/viewport-log.ts');
      return m.startupEvents.map((e) => `${e.t.toFixed(2)}s ${e.kind} ${e.text}`);
    });
  let events = await history();
  for (let i = 0; i < 30 && !events.some((l) => l.includes('cover off')); i++) {
    await page.waitForTimeout(1000);
    events = await history();
  }
  await page.waitForTimeout(500);
  const coverLeft = await page.locator('.viewport-cover').count();
  const coverLogo = await page.evaluate(() => window.__coverLogo ?? null);
  const s = await canvasState(page);
  const has = (text) => events.some((l) => l.includes(text));
  const row = {
    what,
    ok:
      s.rect[2] === VIEW.width &&
      s.rect[3] === 343 &&
      has('startup short') &&
      has('nudge #1 auto') &&
      has('nudge #2 auto') &&
      // 8-6f: 切り替えの間は黒い幕で隠し、試みが尽きたら外す
      has('cover on') &&
      has('cover off') &&
      coverLeft === 0 &&
      // 8-7: 幕の中央にタイトルのロゴ（v1.0.1: 読めなければ文字）
      coverLogo !== null &&
      coverLogo.kind === (failLogo ? 'text' : 'logo') &&
      has(failLogo ? 'logo error' : 'logo ok') &&
      coverLogo.width > 100 &&
      Math.abs(coverLogo.centerX - VIEW.width / 2) <= 2,
    coverLogo,
    events,
    ...s,
  };
  await page.screenshot({ path: `${out}/${shot}.png` });
  await ctx.close();
  return row;
}

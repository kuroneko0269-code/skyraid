/* global document, window, Navigator, Element, Event, ScreenOrientation, performance */
// 実機確認の修正の点検（scripts/ui-audit-device-viewport.js）のうち、iOS のホーム画面から起動して描かれる高さが足りない起動
// （8-6d〜8-6f・v1.0.1 の測り直しの幕、8-7 の幕のロゴ、10-1b の重なり、10-1c のグリッチ）
export const canvasState = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('#app > canvas');
    const r = c.getBoundingClientRect();
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      buffer: [c.width, c.height],
      inner: [window.innerWidth, window.innerHeight],
    };
  });

/**
 * iOS のホーム画面から起動して描かれる高さが足りない（844×343）ときの点検。late なら最初は縦の値で、値を最初に読んでから 1.5 秒後に
 * 横の短い値になる（v1.0.0 の実機の起動）。failLogo なら幕のロゴを 404 にする
 */
export async function standaloneShort({
  browser,
  base,
  out,
  VIEW,
  touchContext,
  toTitle,
  late,
  failLogo,
  reduced,
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
    // 10-1c: 乱れが見えたか（帯に切った・色ずれ・走査線）と、重なった瞬間の「信号」の乱れ（幕のロゴ・タイトルの文字）
    window.__glitchSeen = {
      sliced: false,
      split: 0,
      scan: 0,
      coverSignal: false,
      titleSignal: false,
    };
    const seen = window.setInterval(() => {
      const g = window.__glitchSeen;
      const c = document.querySelector('.viewport-cover');
      if (c) {
        if ([...c.querySelectorAll('.is-slice')].some((e) => e.style.visibility === 'visible'))
          g.sliced = true;
        g.split = Math.max(g.split, parseFloat(c.style.getPropertyValue('--glitch-split')) || 0);
        g.scan = Math.max(g.scan, parseFloat(c.style.getPropertyValue('--glitch-scan')) || 0);
        if (c.classList.contains('is-signal')) g.coverSignal = true;
      }
      if (document.querySelector('.title-logo.is-signal')) g.titleSignal = true;
      if (performance.now() > 20000) window.clearInterval(seen);
    }, 16);
  }, late);
  const page = await ctx.newPage();
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
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
  // 10-1b: 外すと決めた後、ロゴがタイトルの文字へ移って重なってから明ける（移る 0.48 秒・フェード 0.25 秒。重いので長めに待つ）
  await page
    .waitForFunction(() => !document.querySelector('.viewport-cover'), null, { timeout: 5000 })
    .catch(() => undefined);
  const coverLeft = await page.locator('.viewport-cover').count();
  const landing = await page.evaluate(async () => {
    const m = await import('/src/core/viewport-cover.ts');
    return m.coverLanding.result;
  });
  const coverLogo = await page.evaluate(() => window.__coverLogo ?? null);
  const glitchSeen = await page.evaluate(() => window.__glitchSeen ?? null);
  const s = await canvasState(page);
  // 10-1c: 乱れが出て（試みのたびに強く・外す前に一番強く）、ちらつきは 1 秒に 3 回まで、着いたら信号の乱れ
  const g = landing?.glitch;
  const flickers = g?.flickers ?? [];
  const glitchOk = reduced
    ? landing === null &&
      glitchSeen !== null &&
      !glitchSeen.sliced &&
      glitchSeen.split === 0 &&
      glitchSeen.scan === 0 &&
      !glitchSeen.coverSignal &&
      !glitchSeen.titleSignal
    : g !== undefined &&
      g.steps > 10 &&
      g.bandSteps > 0 &&
      g.maxLevel >= 0.99 &&
      ['on', 'pulse', 'peak', 'land', 'landed'].every((w) =>
        g.timeline.some((e) => e.what === w),
      ) &&
      flickers.every((t, i) => i < 3 || t - (flickers[i - 3] ?? 0) > 1000) &&
      glitchSeen !== null &&
      glitchSeen.sliced &&
      glitchSeen.split > 0 &&
      glitchSeen.scan > 0 &&
      glitchSeen.coverSignal &&
      glitchSeen.titleSignal;
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
      Math.abs(coverLogo.centerX - VIEW.width / 2) <= 2 &&
      // 10-1b: タイトルの文字（画像・読めなければ文字）に 2px 以内で重なって止まった（10-1c: 動作を減らす設定では移らない）
      (reduced ||
        (landing !== null &&
          landing.kind === (failLogo ? 'text' : 'logo') &&
          landing.error <= 2)) &&
      glitchOk,
    coverLogo,
    landing,
    glitchSeen,
    events,
    ...s,
  };
  await page.screenshot({ path: `${out}/${shot}.png` });
  await ctx.close();
  return row;
}

/* global document, localStorage, window */
// 公開前の点検の共通部品（8-1）: ページの見張り（console のエラー・HTTP のエラー・CSP 違反・通信先）と画面の操作
import { CONTEXT_LOCALE, L } from './audit-lang.js';

export const VIEWPORT = { width: 844, height: 390 };

/** ページの見張り: console のエラー・例外・CSP 違反・通信先 */
export async function watch(context) {
  const log = { errors: [], csp: [], requests: [] };
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  context.on('page', (page) => attach(page, log));
  // Service Worker のプリキャッシュの取得は数えない（ページが読み込んだものだけ）
  context.on('request', (r) => {
    if (!r.serviceWorker()) log.requests.push(r.url());
  });
  context.on('response', (res) => {
    if (res.status() >= 400) log.errors.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  return log;
}

export function attach(page, log) {
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') log.errors.push(m.text().slice(0, 200));
  });
}

export async function collectCsp(page, log) {
  const v = await page.evaluate(() => window.__csp ?? []).catch(() => []);
  log.csp.push(...v);
}

export const shown = (page, sel) => page.locator(`${sel}.is-shown`).waitFor({ timeout: 30000 });
export const screenIs = (page, name, timeout = 60000) =>
  page
    .waitForFunction((n) => document.documentElement.dataset.screen === n, name, { timeout })
    .then(
      () => true,
      () => false,
    );

/** 名前入力済み・チュートリアルの案内済み（9-5c の「新しくなりました」も）のセーブ（各モードの起動用） */
export async function seed(page) {
  await page.evaluate(() => {
    localStorage.setItem(
      'skyraid.save',
      JSON.stringify({
        version: 9,
        pilotName: 'AUDIT',
        credits: 0,
        missions: {},
        aircraft: {
          selected: 'kestrel',
          owned: { kestrel: { engine: 0, airframe: 0, weapons: 0, avionics: 0 } },
        },
        settings: {},
        flags: { tutorialOffered: true, tutorialNotice: true, assistPreset: true },
      }),
    );
  });
}

export async function toModeSelect(page, base) {
  await page.goto(base);
  await shown(page, '.title-screen');
  await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
  await shown(page, '.mode-select-screen');
}

export const dialogButton = (page, label) =>
  page.locator(`.mode-prompt:not([hidden]) .ui-button:text-is("${L(label)}")`).first();

/** 点検用のページ（8-3: 互換性の点検。opts.init は init script、opts.viewport・opts.touch）*/
export async function newPage(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport ?? VIEWPORT,
    hasTouch: opts.touch ?? true,
    isMobile: false,
    deviceScaleFactor: 1,
    locale: CONTEXT_LOCALE,
  });
  const log = await watch(context);
  if (opts.init) await context.addInitScript(opts.init, opts.arg);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  return { context, log, page };
}

export async function finish(r, page, log, context) {
  await collectCsp(page, log);
  Object.assign(r, { errors: log.errors, csp: log.csp });
  await context.close();
  return r;
}

/** トーストの見本（更新の知らせと「ホーム画面に追加」の案内。開発サーバーの点検で撮る） */
export async function showSampleToasts(page) {
  await page.evaluate(
    async ([update, now, close, install]) => {
      const m = await import('/src/ui/toast.ts');
      m.showToast(update, {
        seconds: 0,
        actions: [{ label: now, kind: 'primary' }, { label: close }],
      });
      m.showToast(install, { seconds: 0, actions: [{ label: close }] });
    },
    [
      L('新しいバージョンがあります（次回の起動で更新）'),
      L('今すぐ更新'),
      L('閉じる'),
      L('共有ボタン →「ホーム画面に追加」で全画面で遊べます'),
    ],
  );
}

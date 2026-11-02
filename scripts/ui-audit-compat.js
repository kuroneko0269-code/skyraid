/* global document, window, HTMLCanvasElement, Image, DOMException, Storage */
// 互換性の点検（8-3。`node scripts/ui-audit.js <出力先> --release` の一部）: 機能が無い・失敗する環境をページの中で作り、
// 例外を出さずに案内・代わりの動きになるかを確かめる。どのエンジンでも同じ作り方（init script で API を消す・投げる）にする。
//   noWebGL      canvas.getContext('webgl2' / 'webgl') が null → 案内画面（真っ黒にしない）
//   noWebGL2     webgl2 だけ null（WebGL1 はある）→ 同じ案内画面
//   legacy       アプリのモジュールが構文エラー（古いブラウザ）→ public/legacy-check.js の案内
//   contextLost  飛行中に WEBGL_lose_context で喪失 → ポーズ。復帰後に描画が続く
//   noStorage    localStorage の取得が例外・indexedDB が無い → 遊べて、保存できない旨のお知らせ
//   quota        localStorage.setItem が QuotaExceededError → 同じお知らせ（1 回だけ）
//   noAudio      AudioContext が無い → 例外なしで飛行まで
//   noDeviceApi  全画面・画面の向きの固定・振動が無い（iOS Safari）→ 全画面のボタンが無く、振動は無効表示
//   portrait     縦向きのスマホ（タッチ・幅 600px 以下）→ どの画面でも「画面を横にしてください」
//   gamepad      ゲームパッドの接続 → 切断で入力が離れる（例外なし）
import {
  VIEWPORT,
  dialogButton,
  finish,
  newPage,
  screenIs,
  seed,
  shown,
  toModeSelect,
} from './audit-helpers.js';
import {
  auditDeviceApis,
  auditGamepad,
  auditNoAudio,
  auditPortrait,
} from './ui-audit-compat-device.js';

/** 案内画面が出たか（.compat-notice の文と、タイトルが出ていないこと） */
async function noticeShown(page) {
  return page
    .locator('.compat-notice')
    .waitFor({ timeout: 20000 })
    .then(
      async () => (await page.locator('.compat-notice').textContent())?.trim() ?? '',
      () => '',
    );
}

/** WebGL を消す init script（mode: 'all' = webgl も webgl2 も / 'webgl2' = webgl2 だけ） */
function hideWebGL(mode) {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (
      type === 'webgl2' ||
      (mode === 'all' && (type === 'webgl' || type === 'experimental-webgl'))
    )
      return null;
    return orig.call(this, type, ...rest);
  };
}

async function auditNoWebGL(browser, base, out, mode) {
  const { context, log, page } = await newPage(browser, { init: hideWebGL, arg: mode });
  const r = { ok: false, steps: [] };
  await page.goto(base);
  const text = await noticeShown(page);
  const title = await page.locator('.title-screen.is-shown').count();
  r.steps.push(text ? `案内画面: ${text.replace(/\s+/g, ' ').slice(0, 80)}` : '案内画面が出ない ⚠');
  r.steps.push(`タイトル ${title ? '表示 ⚠' : 'なし'}`);
  await page.screenshot({ path: `${out}/compat-${mode === 'all' ? 'no-webgl' : 'no-webgl2'}.png` });
  r.ok = text !== '' && title === 0;
  return finish(r, page, log, context);
}

/** 古いブラウザ（モジュールの構文を読めない）: アプリのモジュールを構文エラーにして、public/legacy-check.js の案内が出るか */
async function auditLegacy(browser, base, out) {
  const { context, log, page } = await newPage(browser);
  const r = { ok: false, steps: [] };
  await page.route(/\/assets\/app-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const x = ;' }),
  );
  await page.goto(base);
  const text = await noticeShown(page);
  r.steps.push(text ? `案内画面: ${text.replace(/\s+/g, ' ').slice(0, 60)}` : '案内画面が出ない ⚠');
  await page.screenshot({ path: `${out}/compat-legacy.png` });
  r.ok = text.includes('古い');
  // 構文エラーそのもの（想定どおり）は数えない
  log.errors = log.errors.filter((e) => !/SyntaxError|Unexpected token|unexpected token/i.test(e));
  return finish(r, page, log, context);
}

/** 画面の上半分（空）の平均の明るさ 0〜255。スクリーンショットをページの中で画像にして読む（WebGL の描画バッファは読めないため） */
async function brightness(page) {
  const png = await page.screenshot({ clip: { x: 300, y: 40, width: 240, height: 60 } });
  return page.evaluate(
    (b64) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
          resolve(Math.round(sum / (d.length / 4)));
        };
        img.onerror = () => resolve(-1);
        img.src = `data:image/png;base64,${b64}`;
      }),
    png.toString('base64'),
  );
}

/** 飛行中のコンテキスト喪失 → ポーズ → 復帰して描画が続く */
async function auditContextLost(browser, base, out) {
  const { context, log, page } = await newPage(browser);
  const r = { ok: false, steps: [] };
  await page.goto(base);
  await seed(page);
  await toModeSelect(page, base);
  await page.click('.mode-card[data-mode="free"]');
  await dialogButton(page, '出撃').click();
  const flying = await screenIs(page, 'flight');
  await page.waitForTimeout(2000);
  const lost = await page.evaluate(() => {
    const c = document.querySelector('#app canvas');
    const gl = c?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    window.__loseExt = ext;
    ext.loseContext();
    return true;
  });
  const paused = lost && (await screenIs(page, 'pause', 10000));
  r.steps.push(flying ? '飛行' : '飛行に入れない ⚠');
  r.steps.push(
    lost
      ? paused
        ? '喪失 → ポーズ'
        : '喪失してもポーズにならない ⚠'
      : 'WEBGL_lose_context が無い ⚠',
  );
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__loseExt?.restoreContext());
  await page.waitForTimeout(3000);
  const restored = await page.evaluate(
    () => document.querySelector('#app canvas')?.getContext('webgl2')?.isContextLost() === false,
  );
  await page.screenshot({ path: `${out}/compat-context-restored-pause.png` });
  await page.keyboard.press('Escape');
  const resumed = await screenIs(page, 'flight', 10000);
  await page.waitForTimeout(2500);
  const lit = await brightness(page);
  await page.screenshot({ path: `${out}/compat-context-restored.png` });
  r.steps.push(
    `復帰 ${restored ? 'OK' : 'NG ⚠'}・再開 ${resumed ? 'OK' : 'NG ⚠'}・描画 ${lit > 20 ? `あり（明るさ ${lit}）` : '真っ黒 ⚠'}`,
  );
  r.ok = flying && paused && restored && resumed && lit > 20;
  return finish(r, page, log, context);
}

/** localStorage が例外・indexedDB が無い（古い Safari のプライベート・Cookie を拒否した Firefox など） */
function blockStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
}

/** localStorage の容量超過（書き込みだけ失敗） */
function fullStorage() {
  Storage.prototype.setItem = function () {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
}

async function auditStorage(browser, base, out, kind) {
  const init = kind === 'blocked' ? blockStorage : fullStorage;
  const { context, log, page } = await newPage(browser, { init });
  const r = { ok: false, steps: [] };
  await page.goto(base);
  await shown(page, '.title-screen');
  const toast = async () =>
    page
      .locator('.app-toast', { hasText: '保存できません' })
      .first()
      .waitFor({ timeout: 8000 })
      .then(
        () => true,
        () => false,
      );
  // 初回の名前の入力（保存が起きる）まで進めて、遊べること
  await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
  await shown(page, '.pilot-name-screen');
  await page.fill('.pilot-name-input', 'NOSAVE');
  await page.keyboard.press('Enter');
  await shown(page, '.mode-select-screen');
  const told = await toast();
  await page.screenshot({ path: `${out}/compat-storage-${kind}.png` });
  const count = await page.locator('.app-toast', { hasText: '保存できません' }).count();
  await page.keyboard.press('Escape');
  await page.click('.mode-tile[data-mode="replay"]');
  const replay = await page
    .waitForFunction(() => document.documentElement.dataset.screen === 'replay_select', null, {
      timeout: 15000,
    })
    .then(
      () => true,
      () => false,
    );
  r.steps.push(told ? `お知らせ（${count} 件）` : 'お知らせが出ない ⚠');
  r.steps.push(`リプレイの一覧 ${replay ? '開く' : '開かない ⚠'}`);
  await page.keyboard.press('Escape');
  await page.click('.mode-card[data-mode="free"]').catch(() => undefined);
  await dialogButton(page, '出撃')
    .click({ timeout: 10000 })
    .catch(() => undefined);
  const flying = await screenIs(page, 'flight', 30000);
  r.steps.push(flying ? 'フリーフライトまで' : '飛行に入れない ⚠');
  r.ok = told && count === 1 && replay && flying;
  return finish(r, page, log, context);
}

export async function auditCompat(browser, base, out) {
  const report = {};
  const run = async (name, fn) => {
    try {
      report[name] = await fn();
    } catch (e) {
      report[name] = {
        ok: false,
        steps: [`例外: ${String(e).slice(0, 160)}`],
        errors: [],
        csp: [],
      };
    }
  };
  await run('noWebGL', () => auditNoWebGL(browser, base, out, 'all'));
  await run('noWebGL2', () => auditNoWebGL(browser, base, out, 'webgl2'));
  await run('legacy', () => auditLegacy(browser, base, out));
  await run('contextLost', () => auditContextLost(browser, base, out));
  await run('noStorage', () => auditStorage(browser, base, out, 'blocked'));
  await run('quota', () => auditStorage(browser, base, out, 'quota'));
  await run('noAudio', () => auditNoAudio(browser, base));
  await run('noDeviceApi', () => auditDeviceApis(browser, base, out));
  await run('portrait', () => auditPortrait(browser, base, out));
  await run('gamepad', () => auditGamepad(browser, base));
  return report;
}

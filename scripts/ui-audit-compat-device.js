/* global document, window, navigator, screen, getComputedStyle, Event, Document, Element, Navigator */
// 互換性の点検の端末の機能（8-3。scripts/ui-audit-compat.js から呼ぶ）: 音・全画面 / 向きの固定 / 振動・縦向き・ゲームパッド
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

/** AudioContext が無い */
function removeAudio() {
  delete window.AudioContext;
  delete window.webkitAudioContext;
}

/** 全画面・画面の向きの固定・振動が無い（iPhone の Safari と同じ） */
function removeDeviceApis() {
  for (const k of ['fullscreenEnabled', 'webkitFullscreenEnabled'])
    Object.defineProperty(Document.prototype, k, { configurable: true, get: () => false });
  Element.prototype.requestFullscreen = undefined;
  Object.defineProperty(screen, 'orientation', { configurable: true, value: undefined });
  Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: undefined });
}

export async function auditNoAudio(browser, base) {
  const { context, log, page } = await newPage(browser, { init: removeAudio });
  const r = { ok: false, steps: [] };
  await page.goto(base);
  await seed(page);
  await toModeSelect(page, base);
  await page.click('.mode-card[data-mode="free"]');
  await dialogButton(page, '出撃').click();
  const flying = await screenIs(page, 'flight');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  const paused = await screenIs(page, 'pause', 10000);
  r.steps.push(flying && paused ? '飛行 → ポーズ（音なし）' : '飛行・ポーズに入れない ⚠');
  r.ok = flying && paused;
  return finish(r, page, log, context);
}

export async function auditDeviceApis(browser, base, out) {
  const { context, log, page } = await newPage(browser, { init: removeDeviceApis });
  const r = { ok: false, steps: [] };
  await page.goto(base);
  await seed(page);
  await page.goto(base);
  await shown(page, '.title-screen');
  await page.click('.title-settings');
  await shown(page, '.settings-screen');
  const fullscreen = await page.locator('.settings-screen button', { hasText: '全画面' }).count();
  await page.screenshot({ path: `${out}/compat-no-device-display.png` });
  await page.click('.settings-tabs .ui-seg-item:text-is("操作")');
  await page.waitForTimeout(500);
  const vib = await page.evaluate(() => {
    const b = [
      ...document.querySelectorAll('.settings-screen button, .settings-screen label'),
    ].find((e) => (e.textContent ?? '').includes('振動'));
    return b
      ? {
          text: b.textContent.trim(),
          disabled: b.disabled === true || b.matches('[aria-disabled="true"]'),
        }
      : null;
  });
  await page.screenshot({ path: `${out}/compat-no-device-controls.png` });
  r.steps.push(`全画面のボタン ${fullscreen ? 'あり ⚠' : 'なし'}`);
  r.steps.push(
    vib
      ? `振動: 「${vib.text}」${vib.disabled ? '（押せない）' : ' ⚠ 押せる'}`
      : '振動の項目が無い',
  );
  r.ok = fullscreen === 0 && vib !== null && vib.disabled;
  return finish(r, page, log, context);
}

/** 縦向き（390×844 のタッチ端末）: タイトルと飛行で「画面を横にしてください」が出るか */
export async function auditPortrait(browser, base, out) {
  const viewport = { width: VIEWPORT.height, height: VIEWPORT.width };
  const { context, log, page } = await newPage(browser, { viewport });
  const r = { ok: false, steps: [] };
  const hint = () =>
    page.evaluate(() => {
      const h = document.querySelector('.rotate-hint');
      return !!h && getComputedStyle(h).display !== 'none';
    });
  await page.goto(base);
  await seed(page);
  await page.goto(base);
  await shown(page, '.title-screen');
  await page.waitForTimeout(800);
  const atTitle = await hint();
  await page.screenshot({ path: `${out}/compat-portrait-title.png` });
  // 案内が画面を覆うので、横にして飛行まで進め、縦に戻す
  await page.setViewportSize(VIEWPORT);
  await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
  await shown(page, '.mode-select-screen');
  await page.click('.mode-card[data-mode="free"]');
  await dialogButton(page, '出撃').click();
  await screenIs(page, 'flight');
  const landscape = await hint();
  await page.setViewportSize(viewport);
  await page.waitForTimeout(2000);
  const atFlight = await hint();
  await page.screenshot({ path: `${out}/compat-portrait-flight.png` });
  r.steps.push(
    `タイトル ${atTitle ? '案内あり' : '案内なし ⚠'}・飛行 ${atFlight ? '案内あり' : '案内なし ⚠'}・横向き ${landscape ? '案内あり ⚠' : '案内なし'}`,
  );
  r.ok = atTitle && atFlight && !landscape;
  return finish(r, page, log, context);
}

/** ゲームパッドの抜き差し（getGamepads を偽物にしてイベントを送る） */
function fakeGamepad() {
  const pad = {
    id: 'audit pad',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  window.__pad = pad;
  navigator.getGamepads = () => [pad.connected ? pad : null];
}

export async function auditGamepad(browser, base) {
  const { context, log, page } = await newPage(browser, { init: fakeGamepad, touch: false });
  const r = { ok: false, steps: [] };
  await page.goto(base);
  await seed(page);
  await toModeSelect(page, base);
  await page.click('.mode-card[data-mode="free"]');
  await dialogButton(page, '出撃').click();
  const flying = await screenIs(page, 'flight');
  await page.waitForTimeout(1000);
  const send = (type) =>
    page.evaluate((t) => {
      const e = new Event(t);
      e.gamepad = window.__pad;
      window.dispatchEvent(e);
    }, type);
  await send('gamepadconnected');
  await page.evaluate(() => {
    window.__pad.axes[1] = -1;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__pad.connected = false;
  });
  await send('gamepaddisconnected');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__pad.connected = true;
    window.__pad.axes[1] = 0;
  });
  await send('gamepadconnected');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  const paused = await screenIs(page, 'pause', 10000);
  r.steps.push(flying ? '飛行 → 接続 → 切断 → 再接続' : '飛行に入れない ⚠');
  r.steps.push(paused ? 'キーボードでポーズ' : 'ポーズに入れない ⚠');
  r.ok = flying && paused;
  return finish(r, page, log, context);
}

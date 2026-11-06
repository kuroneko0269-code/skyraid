/* global document */
// 画面の切り替え直後の押し抜けの点検（9-9b。node scripts/ui-audit-device.js <出力先> --only passthrough）。
// iOS のタップを模す: タッチ（touchstart → touchend。8-6 の自前判定がここで click() して画面が切り替わる）の後に、
// ブラウザの互換のクリックを同じ点に送る（CDP のマウス。isTrusted のクリック）。切り替わった後の画面のボタンが
// 押されない（ほかの画面・ダイアログが出ない）ことを確かめる。日替わり → モード選択のほか、画面の組をいくつか
export const shownScreens = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.screen.is-shown')]
      .map((s) => [...s.classList].filter((c) => c !== 'screen' && c !== 'is-shown').join('.'))
      .concat(
        [...document.querySelectorAll('.mode-prompt:not([hidden])')].map(
          (d) => `dialog:${d.className}`,
        ),
      ),
  );

/** 要素の中心を、タッチ → 少し後に互換のクリック（iOS の順）で押す */
export async function iosTap(page, cdp, selector) {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`見えない: ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const point = [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(10);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await page.waitForTimeout(900);
}

export async function auditPassThrough({ browser, base, touchContext, toTitle }) {
  const ctx = await touchContext(browser);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const cdp = await ctx.newCDPSession(page);
  const rows = [];
  const toModes = async () => {
    await toTitle(page, base);
    await page.locator('.title-screen').click({ position: { x: 40, y: 195 } });
    await page.locator('.mode-select-screen.is-shown').waitFor();
    await page.waitForTimeout(600);
  };
  const cases = [
    [
      '日替わり →「モード選択に戻る」',
      '.mode-card[data-mode="daily"]',
      '.daily-screen.is-shown .campaign-back',
    ],
    [
      'リングレース →「← モード選択」',
      '.mode-card[data-mode="race"]',
      '.race-screen.is-shown:not(.daily-screen) .campaign-back',
    ],
    [
      'リプレイ →「← モード選択」',
      '.mode-tile[data-mode="replay"]',
      '.replay-screen.is-shown .campaign-back',
    ],
    [
      '勲章 →「← モード選択」',
      '.mode-tile[data-mode="badges"]',
      '.badge-screen.is-shown .menu-back',
    ],
  ];
  // 9-9b の 3: リプレイが 1 本以上あると一覧の「← モード選択」は下へ送った所にあり、モード選択の「リプレイ」のタイルと
  // 重なる（844×390）。押し抜けると一覧が開き直して「反応しない」に見えた。フリーフライトを 7 秒飛んで自動の記録を作る
  await toModes();
  await page.click('.mode-card[data-mode="free"]');
  await page.locator('.mode-prompt:not([hidden]) .ui-button.is-primary').first().click();
  await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight');
  await page.waitForTimeout(7000);
  await page.keyboard.press('Escape');
  await page.locator('.pause-screen.is-shown').waitFor();
  await page.locator('.pause-screen .pause-title:not([hidden])').first().click();
  await page.locator('.title-screen.is-shown').waitFor();
  cases.push([
    'リプレイ（1 本あり・下へ送って）→「← モード選択」',
    '.mode-tile[data-mode="replay"]',
    '.replay-screen.is-shown .campaign-back',
  ]);
  for (const [what, open, back] of cases) {
    await toModes();
    await page.click(open);
    await page.locator(back).first().waitFor();
    await page.waitForTimeout(600);
    await iosTap(page, cdp, back);
    const screens = await shownScreens(page);
    rows.push({
      what: `押し抜けない: ${what}`,
      ok: screens.length === 1 && screens[0].includes('mode-select-screen'),
      screens,
    });
  }
  // 切り替えの後に押したタップはそのまま届く（モード選択 → 設定の歯車）
  await toModes();
  await iosTap(page, cdp, '.mode-tile[data-mode="settings"]');
  const after = await shownScreens(page);
  rows.push({
    what: '切り替えの後のタップは届く（モード選択 → 設定）',
    ok: after.some((s) => s.includes('settings-screen')),
    screens: after,
  });
  await ctx.close();
  return rows;
}

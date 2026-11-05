/* global document, Image */
// 飛行の始めの天候の点検（9-9b。node scripts/ui-audit-device.js <出力先> --only weather）。
// 天候が快晴と違うモードで飛び始め、始まった直後（暗転幕の後の 1.2 秒）と 4 秒後の空（画面の上 40%）の平均の色を比べる。
// 7-5 から 9-9 までは、メニューの昼・快晴から 3 秒で目的の天候へ移っていたので、直後は快晴に近い色だった
const MODES = [
  {
    // 基準: 天候が変わらない（メニューと同じ昼・快晴）。機体・カメラ・画質の自動調整による変化の大きさ
    name: 'キャンペーン M1（昼・快晴。基準）',
    query: '?unlockAll',
    reference: true,
    go: async (p) => {
      await p.click('.mode-card[data-mode="campaign"]');
      await p.locator('.mission-entry').nth(0).click();
      await p.locator('.briefing-screen.is-shown .ui-button.is-primary').click();
    },
  },
  {
    name: 'キャンペーン M3（昼・曇り）',
    query: '?unlockAll',
    go: async (p) => {
      await p.click('.mode-card[data-mode="campaign"]');
      await p.locator('.mission-entry').nth(2).click();
      await p.locator('.briefing-screen.is-shown .ui-button.is-primary').click();
    },
  },
  {
    name: 'キャンペーン M5（夜・雨）',
    query: '?unlockAll',
    go: async (p) => {
      await p.click('.mode-card[data-mode="campaign"]');
      await p.locator('.mission-entry').nth(4).click();
      await p.locator('.briefing-screen.is-shown .ui-button.is-primary').click();
    },
  },
  {
    name: 'リングレース 夕空アクロバット（夕方）',
    query: '',
    go: async (p) => {
      await p.click('.mode-card[data-mode="race"]');
      await p.locator('.race-course').nth(3).click();
      await p.locator('.race-screen.is-shown .campaign-go').click();
      // 下見はカメラが動くので飛ばす（天候は飛行の始めに決まっている）
      await p.locator('.race-preview:not([hidden])').click();
    },
  },
  {
    name: 'フリーフライト（?weather=night-rain）',
    query: '?weather=night-rain',
    go: async (p) => {
      await p.click('.mode-card[data-mode="free"]');
      await p.locator('.mode-prompt:not([hidden]) .ui-button.is-primary').first().click();
    },
  },
  {
    name: 'ソロのレイド（夕方）',
    query: '',
    go: async (p) => {
      await p.click('.mode-card[data-mode="raid"]');
      await p.locator('.mode-prompt:not([hidden]) .ui-button.is-primary').first().click();
    },
  },
  {
    name: '日替わり（その日の天候）',
    query: '',
    go: async (p) => {
      await p.click('.mode-card[data-mode="daily"]');
      await p.locator('.daily-screen .campaign-go').click();
    },
  },
];

/** PNG の上 40% の平均の色（ブラウザで読む） */
async function skyColor(decoder, png) {
  return decoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = Math.round(img.height * 0.4);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    const n = d.length / 4;
    return sum.map((v) => Math.round(v / n));
  }, png.toString('base64'));
}

export async function auditWeather({ browser, base, touchContext, toTitle, view, out }) {
  const decoder = await browser.newPage();
  const rows = [];
  let baseDiff = 0;
  for (const m of MODES) {
    const ctx = await touchContext(browser);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    await toTitle(page, base + m.query);
    await page.locator('.title-screen').click({ position: { x: 40, y: view.height / 2 } });
    await page.locator('.mode-select-screen.is-shown').waitFor();
    await m.go(page);
    await page.waitForFunction(() => document.documentElement.dataset.screen === 'flight');
    // 始めの暗転幕（0.3 秒）の後
    await page.waitForTimeout(1200);
    const first = await page.screenshot();
    await page.waitForTimeout(4000);
    const later = await page.screenshot({ path: `${out}/weather-${rows.length}.png` });
    const a = await skyColor(decoder, first);
    const b = await skyColor(decoder, later);
    const diff = Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))));
    if (m.reference) baseDiff = diff;
    rows.push({
      what: `始まったときから目的の天候: ${m.name}（空の色の差 ${diff}・基準 ${baseDiff}）`,
      // 機体・カメラ・画質の自動調整で少しは変わる（基準 M1）。3 秒の補間（快晴 → 目的）だと 50 以上変わった
      ok: diff <= Math.max(20, baseDiff + 10),
      first: a,
      later: b,
    });
    await ctx.close();
  }
  await decoder.close();
  return rows;
}

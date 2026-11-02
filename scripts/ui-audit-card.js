/* global document, navigator, window */
// 公開前の点検（8-5）: 記録カード。日本語・英語のそれぞれで、キャンペーン M1 で機首を下げ続けて墜落 → 結果画面の「記録カード」→
// カードの生成（オフラインにしてから）→ 載せた項目・PNG の大きさ・「画像を保存」（ダウンロード）・「文面をコピー」・パイロット名を
// 載せない選択 → ファイル付きの Web Share API がある環境（navigator.share / canShare を差し込む）では「共有」に切り替わり、
// PNG 付きで呼ばれる → Esc で閉じて結果画面に戻る。カードは <出力先>/card-<言語>.png、画面は release-card-*.png
import { readFileSync } from 'node:fs';
import { collectCsp, screenIs, seed, shown, VIEWPORT, watch } from './audit-helpers.js';

const LANGS = [
  { lang: 'ja', locale: 'ja-JP', mode: 'キャンペーン' },
  { lang: 'en', locale: 'en-US', mode: 'Campaign' },
];
const NEED = ['game', 'mode', 'stage', 'headline', 'metric', 'machine', 'pilot', 'date', 'url'];

const cardState = (page) =>
  page.evaluate(() => {
    const o = document.querySelector('.card-overlay');
    const vis = (sel) => {
      const e = document.querySelector(sel);
      return e !== null && !e.hidden && !e.disabled;
    };
    return {
      open: o !== null && !o.hidden,
      items: (o?.dataset.cardItems ?? '').split(' '),
      share: o?.dataset.cardShare ?? '',
      text: document.querySelector('.card-text')?.value ?? '',
      status: document.querySelector('.card-status')?.textContent ?? '',
      buttons: {
        share: vis('.card-share'),
        save: vis('.card-save'),
        copy: vis('.card-copy'),
      },
    };
  });

const ready = (page) =>
  page
    .locator('.card-overlay[data-card-state="ready"]')
    .waitFor({ timeout: 30000 })
    .then(
      () => true,
      () => false,
    );

/** PNG の幅と高さ（IHDR） */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function auditCardLang(browser, base, out, l) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    hasTouch: true,
    locale: l.locale,
    acceptDownloads: true,
  });
  // クリップボードの許可は Chromium だけ（ほかのエンジンでは「コピーできませんでした」の表示を確かめる）
  const clipboard = await context.grantPermissions(['clipboard-read', 'clipboard-write']).then(
    () => true,
    () => false,
  );
  const log = await watch(context);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const r = { ok: false, steps: [] };
  const check = (ok, text) => {
    r.steps.push(`${text}${ok ? '' : ' ⚠'}`);
    return ok;
  };
  let ok = true;
  try {
    await page.goto(base);
    await seed(page);
    await page.goto(base);
    await shown(page, '.title-screen');
    await page.locator('.title-screen').click({ position: { x: 40, y: VIEWPORT.height / 2 } });
    await shown(page, '.mode-select-screen');
    await page.click('.mode-card[data-mode="campaign"]');
    await page.locator('.mission-entry').first().click();
    await page.locator('.briefing-screen.is-shown .ui-button.is-primary').click();
    ok &&= check(await screenIs(page, 'flight'), '飛行');
    // 機首を下げ続けて墜落 → 失敗の結果画面
    await page.keyboard.down('KeyW');
    const result = await screenIs(page, 'result', 120000);
    await page.keyboard.up('KeyW');
    ok &&= check(result, '墜落 → 結果画面');
    await page.waitForTimeout(800);
    const button = page.locator('.result-screen.is-shown .result-card-open');
    ok &&= check(await button.isVisible(), '結果画面の「記録カード」');
    await page.screenshot({ path: `${out}/release-card-result-${l.lang}.png` });
    // 生成と保存は通信なしでできる
    await context.setOffline(true);
    await button.click();
    ok &&= check(await ready(page), 'オフラインでカードを生成');
    let s = await cardState(page);
    const missing = NEED.filter((n) => !s.items.includes(n));
    ok &&= check(missing.length === 0, `載せた項目 ${s.items.join(' ')}`);
    ok &&= check(s.text.includes(l.mode), `文面の言語（${s.text.split('\n')[0]}）`);
    ok &&= check(
      s.share === 'fallback' && s.buttons.save && s.buttons.copy && !s.buttons.share,
      `共有の API なし → 「画像を保存」「文面をコピー」（${s.share}）`,
    );
    await page.screenshot({ path: `${out}/release-card-dialog-${l.lang}.png` });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('.card-save'),
    ]);
    const path = `${out}/card-${l.lang}.png`;
    await download.saveAs(path);
    const size = pngSize(readFileSync(path));
    ok &&= check(
      size?.width === 1200 && size.height === 630,
      `画像を保存 ${download.suggestedFilename()}（${size ? `${size.width}×${size.height}` : '読めない'}）`,
    );
    await page.click('.card-copy');
    await page.waitForTimeout(300);
    s = await cardState(page);
    if (clipboard) {
      const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      ok &&= check(copied === s.text && copied.includes(base), `文面をコピー（${s.status}）`);
    } else check(s.status !== '', `文面をコピー（${s.status}）`);
    // パイロット名を載せない
    await page.click('.card-pilot input');
    ok &&= check(await ready(page), 'パイロット名を外して作り直し');
    s = await cardState(page);
    ok &&= check(!s.items.includes('pilot'), 'パイロット名が載らない');
    // ファイル付きの共有ができる環境（差し込み）→「共有」に切り替わり、PNG 付きで呼ばれる
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = (d) => Array.isArray(d?.files);
      navigator.share = async (d) => {
        window.__shared = {
          files: d.files.length,
          type: d.files[0]?.type ?? '',
          name: d.files[0]?.name ?? '',
          text: d.text ?? '',
        };
      };
    });
    await page.click('.card-pilot input');
    ok &&= check(await ready(page), 'パイロット名を戻して作り直し');
    s = await cardState(page);
    ok &&= check(
      s.share === 'share' && s.buttons.share && s.buttons.save && !s.buttons.copy,
      `共有の API あり → 「共有」「画像を保存」（${s.share}）`,
    );
    await page.click('.card-share');
    await page.waitForTimeout(300);
    const shared = await page.evaluate(() => window.__shared);
    ok &&= check(
      shared?.files === 1 && shared.type === 'image/png' && shared.text.includes(base),
      `共有に PNG と文面を渡す（${shared?.name ?? 'なし'}）`,
    );
    await page.keyboard.press('Escape');
    s = await cardState(page);
    ok &&= check(!s.open && (await screenIs(page, 'result', 3000)), 'Esc で閉じて結果画面のまま');
  } catch (e) {
    ok = false;
    r.steps.push(`例外: ${String(e).slice(0, 160)}`);
    await page
      .screenshot({ path: `${out}/release-card-${l.lang}-error.png` })
      .catch(() => undefined);
  }
  await context.setOffline(false);
  await collectCsp(page, log);
  r.ok = ok;
  // オフラインにしたあとの通信の失敗は数えない
  r.errors = log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
  r.csp = log.csp;
  await context.close();
  return r;
}

/** 日本語・英語の 2 つ（report.card.ja / report.card.en） */
export async function auditCard(browser, base, out) {
  const result = {};
  for (const l of LANGS) result[l.lang] = await auditCardLang(browser, base, out, l);
  return result;
}

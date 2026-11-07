/* global document, process */
// 公開前の点検（9-11b）: 全ミッション・全モードの画面に文言のキーがそのまま出ていないか（「objectives.wave」の形。
// scripts/audit-rawkeys.js）。`node scripts/ui-audit.js <出力先> --release [--lang en]` の rawKeys。844×390 のタッチ端末で:
//   キャンペーン M1〜M8（?unlockAll）: 一覧 → ブリーフィング → 飛行（6 秒。目標・無線・M8 の登場の演出）→ 機首を下げて墜落 → 結果
//   リングレース全コース: 一覧 → 下見 → 飛行 → ポーズ → 中断
//   レイド（ヴォルガス・ネフィルガ）: 怪獣選び → 飛行 → ポーズ → 中断
//   練習場の全課題・日替わり・防衛戦（ソロ）・フリーフライト・チュートリアル全章: 選ぶ画面 → 飛行 → ポーズ → 中断
// 環境変数 RAWKEYS_ONLY=campaign,race（区切りの名前）で一部だけ、RAWKEYS_FROM=6 でキャンペーンを M6 から（調べ直し用）。
// 画面ごとに文書全体（隠れている画面の文も）を調べる。結果は report.rawKeys（steps に画面の数と生のキー、問題の画面は PNG）
import { CONTEXT_LOCALE, L } from './audit-lang.js';
import { rawKeysOn } from './audit-rawkeys.js';
import {
  VIEWPORT,
  collectCsp,
  dialogButton,
  screenIs,
  seed,
  shown,
  toModeSelect,
  watch,
} from './audit-helpers.js';

const FLIGHT_WAIT_MS = 6000;
const ONLY = (process.env.RAWKEYS_ONLY ?? '').split(',').filter(Boolean);
const FROM = Number(process.env.RAWKEYS_FROM ?? '1');

export async function auditRawKeys(browser, base, out) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    hasTouch: true,
    deviceScaleFactor: 1,
    locale: CONTEXT_LOCALE,
  });
  const log = await watch(context);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const url = `${base}?unlockAll`;
  const r = { ok: false, steps: [], screens: [] };
  let scanned = 0;
  let bad = 0;
  const failures = [];

  const scan = async (name) => {
    await page.waitForTimeout(400);
    const issues = await rawKeysOn(page);
    scanned += 1;
    r.screens.push({ screen: name, issues });
    if (issues.length > 0) {
      bad += 1;
      r.steps.push(`${name}: ${issues.map((i) => i.target).join(' / ')} ⚠`);
      await page.screenshot({ path: `${out}/release-rawkey-${name}.png` });
    }
  };
  const flight = async (name) => {
    if (!(await screenIs(page, 'flight'))) throw new Error(`${name}: 飛行にならない`);
    await page.waitForTimeout(FLIGHT_WAIT_MS);
    await scan(`${name}-flight`);
  };
  /** ポーズ → 中断（一覧へ） */
  const abort = async (name) => {
    await page.keyboard.press('Escape');
    if (!(await screenIs(page, 'pause', 15000))) throw new Error(`${name}: ポーズが開かない`);
    await scan(`${name}-pause`);
    await page
      .locator('.pause-screen.is-shown .pause-actions .ui-button.is-danger:visible')
      .first()
      .click();
    await page.waitForFunction(() => document.documentElement.dataset.screen !== 'pause');
  };
  /** 機首を下げ続けて墜落 → 結果画面。60 秒で落ちなければ横にも倒してらせんで降りる（M7 は低空で水平に近いまま残った） */
  const crash = async () => {
    await page.keyboard.down('KeyW');
    let result = await screenIs(page, 'result', 60000);
    if (!result) {
      await page.keyboard.down('KeyA');
      result = await screenIs(page, 'result', 120000);
      await page.keyboard.up('KeyA');
    }
    await page.keyboard.up('KeyW');
    return result;
  };
  const home = async () => {
    await toModeSelect(page, url);
  };
  /** 1 つの区切り。例外は記録して次へ（全体は NG） */
  const section = async (name, fn) => {
    if (ONLY.length > 0 && !ONLY.some((o) => name.startsWith(o))) return;
    try {
      await home();
      await fn();
    } catch (e) {
      failures.push(name);
      r.steps.push(`${name}: 例外 ${String(e).slice(0, 160)} ⚠`);
      await page
        .screenshot({ path: `${out}/release-rawkey-${name}-error.png` })
        .catch(() => undefined);
    }
  };

  await page.goto(base);
  await seed(page);
  await home();
  await scan('mode-select');

  // キャンペーン M1〜M8: 一覧 → ブリーフィング → 飛行 → 墜落 → 結果
  await section('campaign', async () => {
    await page.click('.mode-card[data-mode="campaign"]');
    const entries = page.locator('.mission-entry:visible');
    await entries.first().waitFor();
    await scan('campaign-list');
    const count = await entries.count();
    for (let i = FROM - 1; i < count; i++) {
      const m = `m${i + 1}`;
      await entries.nth(i).click();
      await shown(page, '.briefing-screen');
      await scan(`${m}-briefing`);
      await page.locator('.briefing-screen.is-shown .ui-button.is-primary').click();
      await flight(m);
      const result = await crash();
      if (!result) throw new Error(`${m}: 結果画面にならない`);
      await page.waitForTimeout(800);
      await scan(`${m}-result`);
      await page.locator('.result-screen.is-shown .campaign-back').click();
      await entries.first().waitFor();
    }
    r.steps.push(`キャンペーン ${count} 本`);
  });

  // リングレース: 全コース
  await section('race', async () => {
    await page.click('.mode-card[data-mode="race"]');
    await shown(page, '.race-screen');
    const courses = page.locator('.race-screen.is-shown .race-course');
    const count = await courses.count();
    for (let i = 0; i < count; i++) {
      const name = `race${i + 1}`;
      await courses.nth(i).click();
      await scan(`${name}-select`);
      await page.locator(`.ui-button.is-primary:text-is("${L('スタート')}"):visible`).click();
      const preview = page.locator('.race-preview:not([hidden])');
      if (
        await preview.waitFor({ timeout: 15000 }).then(
          () => true,
          () => false,
        )
      ) {
        await page.waitForTimeout(1500);
        await scan(`${name}-preview`);
        await preview.click();
      }
      await flight(name);
      await abort(name);
      await shown(page, '.race-screen');
    }
    r.steps.push(`リングレース ${count} コース`);
  });

  // レイド: 怪獣ごと
  for (const kaiju of ['vorgas', 'nephirga', 'albion'])
    await section(`raid-${kaiju}`, async () => {
      await page.click('.mode-card[data-mode="raid"]');
      await page.locator('.raid-select-wrap:not([hidden])').waitFor();
      const seg = page.locator(`.raid-select .raid-kaiju-seg .ui-seg-item[data-value="${kaiju}"]`);
      if (await seg.count()) await seg.click();
      await scan(`raid-${kaiju}-select`);
      await page.locator('.raid-select .raid-solo').click();
      await flight(`raid-${kaiju}`);
      await abort(`raid-${kaiju}`);
    });

  // 練習場: 全課題
  await section('practice', async () => {
    await page.click('.mode-card[data-mode="practice"]');
    const drills = page.locator('.practice-screen .race-course');
    await drills.first().waitFor();
    const count = await drills.count();
    for (let i = 0; i < count; i++) {
      const name = `practice${i + 1}`;
      await drills.nth(i).click();
      await scan(`${name}-select`);
      await page.locator('.practice-screen .campaign-go').click();
      await flight(name);
      await abort(name);
      await drills.first().waitFor();
    }
    r.steps.push(`練習場 ${count} 課題`);
  });

  await section('daily', async () => {
    await page.click('.mode-card[data-mode="daily"]');
    await shown(page, '.daily-screen');
    await scan('daily-select');
    await page.locator('.daily-screen .campaign-go').click();
    await flight('daily');
    await abort('daily');
  });

  await section('defense', async () => {
    await page.click('.mode-card[data-mode="defense"]');
    await scan('defense-dialog');
    await dialogButton(page, 'ソロで出撃').click();
    await flight('defense');
    await abort('defense');
  });

  await section('free', async () => {
    await page.click('.mode-card[data-mode="free"]');
    await scan('free-dialog');
    await dialogButton(page, '出撃').click();
    await flight('free');
    await page.keyboard.press('Escape');
    await screenIs(page, 'pause', 15000);
    await scan('free-pause');
  });

  // チュートリアル: 全章
  await section('tutorial', async () => {
    await page.click('.mode-card[data-mode="tutorial"]');
    const chapters = page.locator('.tutorial-chapter');
    await chapters.first().waitFor();
    await scan('tutorial-list');
    const count = await chapters.count();
    let flown = 0;
    for (let i = 0; i < count; i++) {
      const name = `tutorial${i + 1}`;
      await chapters.nth(i).click();
      // 飛ばない章（補助の設定と練習場の案内）は画面だけ
      if (!(await screenIs(page, 'flight', 15000))) {
        await scan(`${name}-screen`);
        await home();
        await page.click('.mode-card[data-mode="tutorial"]');
        await chapters.first().waitFor();
        continue;
      }
      flown += 1;
      await page.waitForTimeout(FLIGHT_WAIT_MS);
      await scan(`${name}-flight`);
      await abort(name);
      if (
        !(await chapters
          .first()
          .waitFor({ timeout: 15000 })
          .then(
            () => true,
            () => false,
          ))
      ) {
        await home();
        await page.click('.mode-card[data-mode="tutorial"]');
        await chapters.first().waitFor();
      }
    }
    r.steps.push(`チュートリアル ${count} 章（飛ぶ章 ${flown}）`);
  });

  r.steps.unshift(`調べた画面 ${scanned}・生のキーが出た画面 ${bad}`);
  r.ok = bad === 0 && failures.length === 0 && scanned > 0;
  await collectCsp(page, log);
  Object.assign(r, { errors: log.errors, csp: log.csp });
  await context.close();
  return r;
}

/* global document */
// 公開前の点検（8-1）: 全モードを 844×390 のタッチ端末で通しで起動する。飛行するモードはポーズが開くまで、
// PvP・協力はロビー画面まで（?net=local では部屋を作ってロビーの部屋まで）。ハンガーとリプレイの一覧も開く
import { CONTEXT_LOCALE, L } from './audit-lang.js';
import {
  VIEWPORT,
  collectCsp,
  dialogButton,
  screenIs,
  seed,
  toModeSelect,
  watch,
} from './audit-helpers.js';

/** モードごとの起動の手順。kind: flight（飛行まで）/ lobby（ロビー画面まで） */
const MODES = [
  {
    // 9-5c: 章の一覧から第 1 章
    name: 'tutorial',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="tutorial"]');
      await p.locator('.tutorial-chapter[data-chapter="steer"]').click();
    },
  },
  {
    name: 'campaign-m1',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="campaign"]');
      await p.locator('.mission-entry').first().click();
      await p.locator('.briefing-screen.is-shown .ui-button.is-primary').click();
    },
  },
  {
    name: 'free',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="free"]');
      await dialogButton(p, '出撃').click();
    },
  },
  {
    name: 'race',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="race"]');
      await p.locator('.race-course').first().click();
      await p.locator(`.ui-button.is-primary:text-is("${L('スタート')}"):visible`).click();
      // 9-8: 初めてのコースはスタート前の下見（押すと飛ばす）
      await p.locator('.race-preview:not([hidden])').click();
    },
  },
  {
    // 9-5: 練習場（課題の一覧 → 止まった的）
    name: 'practice',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="practice"]');
      await p.locator('.practice-screen .race-course').first().click();
      await p.locator('.practice-screen .campaign-go').click();
    },
  },
  {
    // 9-9: 日替わりチャレンジ（日替わりの画面 → 挑戦する）
    name: 'daily',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="daily"]');
      await p.locator('.daily-screen .campaign-go').click();
    },
  },
  {
    name: 'raid-solo',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="raid"]');
      await dialogButton(p, 'ソロで出撃').click();
    },
  },
  {
    name: 'defense-solo',
    kind: 'flight',
    go: async (p) => {
      await p.click('.mode-card[data-mode="defense"]');
      await dialogButton(p, 'ソロで出撃').click();
    },
  },
  { name: 'pvp-lobby', kind: 'lobby', go: (p) => p.click('.mode-card[data-mode="pvp"]') },
  {
    name: 'raid-coop-lobby',
    kind: 'lobby',
    go: async (p) => {
      await p.click('.mode-card[data-mode="raid"]');
      await dialogButton(p, '協力 2〜4人').click();
    },
  },
  {
    name: 'defense-coop-lobby',
    kind: 'lobby',
    go: async (p) => {
      await p.click('.mode-card[data-mode="defense"]');
      await dialogButton(p, '協力 2〜4人').click();
    },
  },
  {
    name: 'pvp-room-local',
    kind: 'room',
    query: '?net=local',
    go: async (p) => {
      await p.click('.mode-card[data-mode="pvp"]');
      await p.locator(`.ui-button:text-is("${L('部屋を作る')}")`).click();
    },
  },
  {
    name: 'hangar',
    kind: 'screen',
    screen: 'hangar',
    go: (p) => p.click('.mode-tile[data-mode="hangar"]'),
  },
  { name: 'replay', kind: 'screen', go: (p) => p.click('.mode-tile[data-mode="replay"]') },
];

export async function auditModes(browser, base, out) {
  const results = [];
  for (const m of MODES) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      hasTouch: true,
      deviceScaleFactor: 1,
      locale: CONTEXT_LOCALE,
    });
    const log = await watch(context);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const r = { mode: m.name, ok: false, detail: '' };
    try {
      await page.goto(base + (m.query ?? ''));
      await seed(page);
      await toModeSelect(page, base + (m.query ?? ''));
      await m.go(page);
      if (m.kind === 'flight') {
        r.ok = await screenIs(page, 'flight');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${out}/release-${m.name}.png` });
        await page.keyboard.press('Escape');
        const paused = await screenIs(page, 'pause', 15000);
        r.detail = paused ? '飛行 → ポーズ' : 'ポーズが開かない';
        r.ok &&= paused;
      } else if (m.kind === 'lobby' || m.kind === 'room') {
        r.ok = await screenIs(page, 'lobby');
        if (m.kind === 'room')
          r.ok &&= await page
            .locator('.lobby-room:not([hidden]), .lobby-code')
            .first()
            .waitFor({ timeout: 20000 })
            .then(
              () => true,
              () => false,
            );
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `${out}/release-${m.name}.png` });
        r.detail = m.kind === 'room' ? 'ロビーの部屋（?net=local）' : 'ロビー画面';
      } else {
        await page.waitForTimeout(1500);
        r.ok =
          (await page.evaluate(() => document.documentElement.dataset.screen)) !== 'mode_select';
        await page.screenshot({ path: `${out}/release-${m.name}.png` });
        r.detail = await page.evaluate(() => document.documentElement.dataset.screen ?? '');
      }
    } catch (e) {
      r.detail = `例外: ${String(e).slice(0, 160)}`;
      await page.screenshot({ path: `${out}/release-${m.name}-error.png` }).catch(() => undefined);
    }
    await collectCsp(page, log);
    r.errors = log.errors;
    r.csp = log.csp;
    results.push(r);
    await context.close();
  }
  return results;
}

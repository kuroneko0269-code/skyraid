/* global document */
// モード選択の全カード・タイルとダイアログの押し抜けの点検（9-11a。node scripts/ui-audit-device.js <出力先> --only cards）。
// 9-9b の passthrough と同じく iOS のタップ（タッチ → 少し後に互換のクリック）で押し、開いた画面・ダイアログのボタンが
// 同じタップで押されない（チュートリアルの章の一覧を飛ばして始まる・ダイアログの出撃が押される など）ことを確かめる
import { iosTap, shownScreens } from './ui-audit-device-switch.js';
import { openLobbySample } from './lobby-samples.js';

const screenName = (page) => page.evaluate(() => document.documentElement.dataset.screen ?? '');

/** カード・タイルを押した後に、ちょうどそれだけが開いている（expect: 画面のクラス or dialog:クラス） */
const CARDS = [
  ['チュートリアル', '.mode-card[data-mode="tutorial"]', 'dialog:mode-prompt tutorial-list'],
  ['日替わり', '.mode-card[data-mode="daily"]', 'daily-screen'],
  ['キャンペーン', '.mode-card[data-mode="campaign"]', 'campaign-screen'],
  ['練習場', '.mode-card[data-mode="practice"]', 'practice-screen'],
  ['リングレース', '.mode-card[data-mode="race"]', 'race-screen'],
  ['フリーフライト', '.mode-card[data-mode="free"]', 'dialog:mode-prompt'],
  ['レイド', '.mode-card[data-mode="raid"]', 'dialog:mode-prompt raid-select-wrap'],
  ['防衛戦', '.mode-card[data-mode="defense"]', 'dialog:mode-prompt'],
  ['PvP', '.mode-card[data-mode="pvp"]', 'lobby-screen'],
  ['ハンガー', '.mode-tile[data-mode="hangar"]', 'hangar-screen'],
  ['リプレイ', '.mode-tile[data-mode="replay"]', 'replay-screen'],
  ['勲章', '.mode-tile[data-mode="badges"]', 'badge-screen'],
  ['設定', '.mode-tile[data-mode="settings"]', 'settings-screen'],
  ['情報', '.mode-tile[data-mode="info"]', 'info-screen'],
];

/** 開いたものがちょうど expect だけか（ダイアログはモード選択の上に 1 つ、画面は 1 つ） */
function matches(screens, expect) {
  if (expect.startsWith('dialog:')) {
    const dialogs = screens.filter((s) => s.startsWith('dialog:'));
    return (
      dialogs.length === 1 &&
      dialogs[0] === expect &&
      screens.filter((s) => !s.startsWith('dialog:')).every((s) => s.includes('mode-select-screen'))
    );
  }
  return screens.length === 1 && screens[0].split('.').includes(expect);
}

export async function auditCards({ browser, base, touchContext, toTitle }) {
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
  for (const [what, sel, expect] of CARDS) {
    await toModes();
    if (!(await page.locator(sel).first().isVisible())) {
      rows.push({ what: `カード: ${what}（出ていない）`, ok: true, screens: [] });
      continue;
    }
    await iosTap(page, cdp, sel);
    // 開くのに時間がかかる画面（ハンガーの機体の用意など）を待つ（最大 10 秒）。押し抜けはこの間に起きている。
    // 10-2: 1.1.0 から通しの点検でハンガーが NG だったのは、点検ではなくアプリの押し抜け（ハンガーの用意で主スレッドが 1 秒を
    // 超えてふさがり、互換のクリックが見張りの時間の後に届いて同じ位置の「‹ 戻る」が押された。src/core/tap.ts の fromTouch）
    await page
      .waitForFunction(
        (exp) =>
          exp.startsWith('dialog:')
            ? document.querySelector('.mode-prompt:not([hidden])') !== null
            : document.querySelector(`.screen.is-shown.${exp}`) !== null &&
              !document.querySelector('.mode-select-screen.is-shown'),
        expect,
        { timeout: 10000 },
      )
      .catch(() => undefined);
    await page.waitForTimeout(900);
    const screens = await shownScreens(page);
    const flight = (await screenName(page)) === 'flight';
    // チュートリアルは一覧（頁ではない）のまま
    const listOk =
      what !== 'チュートリアル' ||
      (await page.locator('.tutorial-list:not([hidden]) .tutorial-chapter').first().isVisible());
    rows.push({
      what: `カード: ${what} → ${expect} だけ（次のボタンが押されない）`,
      ok: !flight && matches(screens, expect) && listOk,
      screens,
    });
  }
  // ダイアログのボタン: 押した結果だけが起き、その下のカードが押されない
  const dialogCases = [
    ['フリーフライト →「戻る」', '.mode-card[data-mode="free"]', '.ui-button.is-ghost', 'modes'],
    ['レイド →「戻る」', '.mode-card[data-mode="raid"]', '.ui-button.is-ghost', 'modes'],
    ['防衛戦 →「戻る」', '.mode-card[data-mode="defense"]', '.ui-button.is-ghost', 'modes'],
    [
      'チュートリアルの一覧 →「戻る」',
      '.mode-card[data-mode="tutorial"]',
      '.campaign-back',
      'modes',
    ],
    [
      'チュートリアルの一覧 → 補助の章（頁が開くだけ）',
      '.mode-card[data-mode="tutorial"]',
      '.tutorial-chapter[data-chapter="assist"]',
      'page',
    ],
    [
      'チュートリアルの一覧 → 第 1 章',
      '.mode-card[data-mode="tutorial"]',
      '.tutorial-chapter[data-chapter="steer"]',
      'flight',
    ],
    ['フリーフライト →「出撃」', '.mode-card[data-mode="free"]', '.ui-button.is-primary', 'flight'],
    // 9-10d: レイドの怪獣選び（怪獣・難易度の切り替えはダイアログのまま・「ソロで出撃」で飛ぶ）
    [
      'レイド → 怪獣の切り替え（ネフィルガ）',
      '.mode-card[data-mode="raid"]',
      '.raid-kaiju-seg .ui-seg-item[data-value="nephirga"]',
      'dialog',
    ],
    [
      'レイド → 難易度の切り替え（高難度）',
      '.mode-card[data-mode="raid"]',
      '.raid-diff-seg .ui-seg-item[data-value="hard"]',
      'dialog',
    ],
    ['レイド →「ソロで出撃」', '.mode-card[data-mode="raid"]', '.raid-solo', 'flight'],
  ];
  for (const [what, card, button, expect] of dialogCases) {
    await toModes();
    await page.click(card);
    const target = `.mode-prompt:not([hidden]) ${button}`;
    const there = await page
      .locator(target)
      .first()
      .waitFor({ timeout: 15000 })
      .then(
        () => true,
        () => false,
      );
    if (!there) {
      // カードを押した時点で押し抜けて、ダイアログが出ていない（または閉じた）
      rows.push({ what: `ダイアログ: ${what}`, ok: false, screens: await shownScreens(page) });
      continue;
    }
    await page.waitForTimeout(600);
    await iosTap(page, cdp, target);
    await page.waitForTimeout(expect === 'flight' ? 2500 : 0);
    const screens = await shownScreens(page);
    const name = await screenName(page);
    let ok;
    if (expect === 'modes') ok = screens.length === 1 && screens[0].includes('mode-select-screen');
    else if (expect === 'dialog')
      ok = matches(screens, 'dialog:mode-prompt raid-select-wrap') && name !== 'flight';
    else if (expect === 'page')
      ok = (await page.locator('.tutorial-page:not([hidden])').isVisible()) && name !== 'flight';
    else ok = name === 'flight';
    rows.push({ what: `ダイアログ: ${what}`, ok, screens: [...screens, `screen=${name}`] });
  }
  // 9-10d: ロビーの部屋の画面（見本）の「定型文」→ ダイアログが開くだけ、定型文を選ぶ → 閉じるだけ（下の席・ボタンが押されない）
  await toModes();
  await openLobbySample(page, 'guest-ffa');
  await page.waitForTimeout(600);
  await iosTap(page, cdp, '.lobby-screen.is-shown .lobby-chat-open');
  await page.waitForTimeout(600);
  const chatOpen = await page.locator('.lobby-chat-dialog').isVisible();
  rows.push({ what: 'ロビー →「定型文」（ダイアログが開くだけ）', ok: chatOpen, screens: [] });
  await iosTap(page, cdp, '.lobby-chat-dialog .lobby-chat-button');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    chat: document.querySelector('.lobby-chat-dialog')?.closest('[hidden]') === null,
    overlays: [...document.querySelectorAll('.lobby-overlay')].filter((e) => !e.hidden).length,
  }));
  rows.push({
    what: 'ロビーの定型文 → 選ぶ（閉じるだけ。ハンガー・QR が開かない）',
    ok: !after.chat && after.overlays === 0,
    screens: [],
  });
  await ctx.close();
  return rows;
}

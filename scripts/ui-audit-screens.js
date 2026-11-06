/* global document, setTimeout */
// UI の点検の続き（8-6d）: scripts/ui-audit.js の 3 サイズのそれぞれで、メニューの残りの画面・タブ・ダイアログも撮って、
// 横スクロール（hscrollEl）とフォント（serif）を含む機械チェックをする（audit-inspect.js）。
// キャンペーン（ミッション一覧・ブリーフィング）・リングレース・フリーフライト / レイド / 防衛戦のダイアログ・ハンガー（性能・塗装の
// 翼 / 尾翼）・リプレイ・PvP のロビー・セーブデータの削除の確認・記録カードの画面・設定のデータ（オンライン連携中・メンバー管理の
// 見本。環境変数なしでも画面の部品を作って差し込む）・メンバーの取り消しの確認・練習場（9-5: 課題の一覧・飛行の HUD・ポーズの
// 「やり直す」と設定の欄・結果の見本と M1 の失敗の案内）・チュートリアル（9-5c。ui-audit-tutorial.js）
import { L } from './audit-lang.js';
import { auditTutorialScreens } from './ui-audit-tutorial.js';
import { openLobbySample } from './lobby-samples.js';

export { openLobbySample };

/** M1 の失敗のリザルトを見本で出す（練習場への案内つき） */
export async function openFailedResultSample(page) {
  await page.evaluate(async () => {
    const { ResultScreen } = await import('/src/ui/result.ts');
    const screen = new ResultScreen(document.body, {
      onRetry: () => undefined,
      onList: () => undefined,
      onPractice: () => undefined,
    });
    const def = {
      id: 'bandits',
      type: 'kill',
      required: true,
      start: 'afterPrevious',
      target: 'enemyFighter',
      count: 2,
    };
    screen.show(
      {
        missionId: 'training',
        outcome: 'failed',
        failReason: 'outOfBounds',
        elapsedSeconds: 305,
        damageTaken: 40,
        maxHp: 100,
        objectives: [{ id: 'bandits', def, status: 'failed', current: 1, target: 2 }],
        rank: null,
        credits: 0,
      },
      { balance: 1200, pilotName: 'ACE', newGear: false, practiceHint: 'failed' },
    );
    screen.setShown(true);
  });
}

/** 練習場の結果の画面を見本で出す（60〜90 秒飛ばずに。設定の欄も見本のセーブで） */
export async function openPracticeResultSample(page) {
  await page.evaluate(async () => {
    const { PracticeResultScreen } = await import('/src/ui/practice-result.ts');
    const { PracticeSettingsPanel } = await import('/src/ui/practice-settings.ts');
    const { defaultControls } = await import('/src/core/control-settings.ts');
    const screen = new PracticeResultScreen(document.body, {
      onRetry: () => undefined,
      onList: () => undefined,
    });
    const save = { settings: { controls: defaultControls() }, updateControls: () => undefined };
    const tilt = { enable: () => Promise.resolve('unsupported'), disable: () => undefined };
    new PracticeSettingsPanel(screen.settingsSlot, save, tilt, () => undefined);
    // 9-9c: 「リプレイを保存」（飛行の後はいつもある）
    const { ReplaySaveBox } = await import('/src/ui/replay-save.ts');
    new ReplaySaveBox(screen.extras, () => Promise.resolve('')).reset('PRACTICE', true);
    const result = {
      drill: 'bandit',
      seconds: 90,
      score: 698,
      kills: 6,
      shots: 220,
      hits: 36,
      accuracy: 0.1636,
      avgKillSeconds: 12.01,
      offAim: 0.7876,
      offScreen: 0.1782,
      offScreenSeconds: 14.6,
      overshoots: 52,
      overshootPerMinute: 34.7,
      offRange: 0.312,
      overtakes: 4,
      advice: 'offAim',
      // 9-5c: 問題を 3 つ（いちばん長い組み合わせ）と良かった点
      issues: ['overtake', 'offRange', 'offAim'],
      good: 'fastKills',
    };
    const best = {
      settings: 'touch:direct:normal:1:1.5:s',
      aircraftId: 'kestrel',
      score: 698,
      kills: 6,
      accuracy: 0.164,
      date: Date.parse('2026-11-04T00:00:00Z'),
    };
    const out = { newBest: true, newSettingsBest: true, previous: null, best };
    screen.show(
      result,
      { kind: 'saved', out },
      {
        settings: 'touch:direct:normal:1:1.5:s',
        pilotName: 'ACE',
      },
    );
    screen.setShown(true);
  });
}

/** 設定のデータのタブに、オンライン連携（連携中・owner）とメンバー管理の見本を差し込む（Supabase につながない） */
export async function showOnlineSample(page) {
  await page.evaluate(async () => {
    if (document.querySelector('.member-settings')) return;
    const panel = document.querySelector('.settings-slot[data-slot="data"]');
    if (!panel) throw new Error('設定のデータの slot が無い');
    const saveBox = panel.querySelector('.save-data');
    const status = {
      state: 'linked',
      enabled: true,
      userId: 'u0',
      owner: true,
      email: 'owner@example.com',
      join: 'approved',
      joinError: null,
      error: null,
    };
    const service = {
      status,
      onStatus: () => undefined,
      sendCode: () => Promise.resolve(),
      verifyCode: () => Promise.resolve(),
      recheck: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
      setEnabled: () => undefined,
    };
    const { createOnlineSettings } = await import('/src/ui/online-settings.ts');
    const { createMemberSettings } = await import('/src/ui/member-settings.ts');
    createOnlineSettings(panel, service, saveBox);
    const rows = [
      { userId: 'u0', displayName: 'ACE', status: 'approved', requestedAt: null },
      {
        userId: 'u1',
        displayName: 'ALPHA',
        status: 'approved',
        requestedAt: '2026-10-01T00:00:00Z',
      },
      {
        userId: 'u2',
        displayName: 'BRAVO',
        status: 'pending',
        requestedAt: '2026-11-01T03:00:00Z',
      },
      {
        userId: 'u3',
        displayName: 'CHARLIE7',
        status: 'pending',
        requestedAt: '2026-11-02T08:30:00Z',
      },
      { userId: 'u4', displayName: null, status: 'approved', requestedAt: '2026-09-12T00:00:00Z' },
    ];
    const admin = {
      rows,
      load: () => Promise.resolve(rows),
      clear: () => undefined,
      renameSelf: () => false,
      act: () => Promise.resolve(false),
    };
    createMemberSettings(panel, admin, saveBox).update(status, 'ACE');
    await new Promise((r) => setTimeout(r, 100));
  });
}

/** 記録カードの画面をミッションの結果の見本で開く（場面の画像なし） */
export async function openCardSample(page) {
  await page.evaluate(async () => {
    const { CardDialog } = await import('/src/ui/card/card-dialog.ts');
    const d = new CardDialog(document.body);
    await d.open(
      {
        mode: 'mission',
        missionId: 'first-sortie',
        aircraftId: 'kestrel',
        paint: null,
        pilotName: 'ACE',
        date: Date.parse('2026-11-02T12:00:00Z'),
        success: true,
        rank: 'A',
        seconds: 187,
      },
      null,
    );
  });
  await page.locator('.card-overlay:not([hidden])').waitFor({ timeout: 20000 });
}

/** shot(name, selector) で撮って点検する（ui-audit.js の shot）。page は Playwright のページ */
export async function auditMoreScreens(page, base, size, shot, shown) {
  const toModeSelect = async () => {
    await page.goto(base);
    await shown('.title-screen');
    await page.locator('.title-screen').click({ position: { x: 40, y: size.height / 2 } });
    await shown('.mode-select-screen');
  };
  const dialog = '.mode-prompt:not([hidden])';

  // キャンペーン: ミッション一覧 → ブリーフィング
  await toModeSelect();
  await page.click('.mode-card[data-mode="campaign"]');
  await shown('.campaign-screen');
  await shot('campaign', '.campaign-screen.is-shown');
  await page.locator('.mission-entry').first().click();
  await shown('.briefing-screen');
  await shot('briefing', '.briefing-screen');

  // リングレース
  await toModeSelect();
  await page.click('.mode-card[data-mode="race"]');
  await shown('.race-screen');
  await shot('race', '.race-screen.is-shown');

  // フリーフライト・レイド・防衛戦のダイアログ
  for (const mode of ['free', 'raid', 'defense', 'tutorial']) {
    await toModeSelect();
    await page.click(`.mode-card[data-mode="${mode}"]`);
    const open = await page
      .locator(dialog)
      .first()
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      );
    if (open) await shot(`dialog-${mode}`, dialog);
  }

  // 9-5c: チュートリアル（scripts/ui-audit-tutorial.js）
  await auditTutorialScreens(page, shot, toModeSelect, dialog);

  // ハンガー: 性能 → 塗装（翼・尾翼）
  await toModeSelect();
  await page.click('.mode-tile[data-mode="hangar"]');
  await shown('.hangar-screen');
  await shot('hangar-perf', '.hangar-screen');
  await page.click(`.hangar-tabs .ui-seg-item:text-is("${L('塗装')}")`);
  await shot('hangar-paint', '.hangar-screen');
  // 「尾翼」の小タブは今の画面に無い（文言の表にも無い）ので、訳が無ければ飛ばす（8-7: --lang en で止まっていた）
  let finLabel;
  try {
    finLabel = L('尾翼');
  } catch {
    finLabel = null;
  }
  const fin = page.locator(`.hangar-screen .ui-seg-item:text-is("${finLabel ?? '尾翼'}")`);
  if (finLabel !== null && (await fin.count())) {
    await fin.first().click();
    await shot('hangar-paint-fin', '.hangar-screen');
  }

  // リプレイの一覧
  await toModeSelect();
  await page.click('.mode-tile[data-mode="replay"]');
  await shown('.replay-screen');
  await shot('replay', '.replay-screen.is-shown');

  // PvP のロビー
  await toModeSelect();
  await page.click('.mode-card[data-mode="pvp"]');
  await shown('.lobby-screen');
  await shot('lobby', '.lobby-screen.is-shown');
  // 9-10d: 部屋の画面（ホスト・参加者・チーム戦・協力レイド・協力防衛戦）と定型文のダイアログ
  for (const variant of ['host-ffa', 'guest-ffa', 'host-team', 'host-raid', 'guest-defense']) {
    await toModeSelect();
    await openLobbySample(page, variant);
    await shot(`lobby-${variant}`, '.lobby-screen.is-shown');
    if (variant === 'host-ffa') {
      await page.click(`.lobby-screen.is-shown .lobby-config .practice-tab[data-tab="options"]`);
      await shot('lobby-host-ffa-options', '.lobby-screen.is-shown');
      await page.click('.lobby-screen.is-shown .lobby-chat-open');
      await shot('dialog-lobby-chat', '.lobby-chat-dialog');
    }
  }
  // 9-10d: レイドの怪獣選び（ネフィルガ・高難度）
  await toModeSelect();
  await page.click('.mode-card[data-mode="raid"]');
  await page.locator('.raid-select-wrap:not([hidden])').waitFor();
  await page.click('.raid-select .raid-kaiju-seg .ui-seg-item[data-value="nephirga"]');
  await page.click('.raid-select .raid-diff-seg .ui-seg-item[data-value="hard"]');
  await shot('dialog-raid-nephirga', '.raid-select-wrap');

  // 設定のデータ: オンライン連携中・メンバー管理の見本、セーブデータの削除の確認、取り消しの確認のダイアログ
  await toModeSelect();
  await page.click('.mode-tile[data-mode="settings"]');
  await shown('.settings-screen');
  await page.click(`.settings-tabs .ui-seg-item:text-is("${L('データ', 'settings.')}")`);
  await showOnlineSample(page);
  await shot('settings-data-online', '.settings-screen');
  await page.locator('.member-settings').screenshot({ path: shotPath(size, 'members') });
  await page.click('.save-settings-danger');
  await shot('settings-data-delete', '.settings-screen');
  const revoke = page.locator(`.member-row .member-button:text-is("${L('取り消し')}")`).first();
  if (await revoke.count()) {
    await revoke.click();
    await shot('dialog-member-revoke', '.online-sync-dialog');
    await page.locator(`.online-sync-dialog .ui-button:text-is("${L('やめる')}")`).click();
  }

  // 練習場（9-5）: 課題の一覧 → スタート → 飛行の HUD → ポーズ（やり直す・設定の欄）→ 結果の見本
  await toModeSelect();
  await page.click('.mode-card[data-mode="practice"]');
  await shown('.practice-screen');
  await shot('practice', '.practice-screen.is-shown');
  await page.locator('.practice-screen .race-course').nth(2).click();
  await shot('practice-bandit', '.practice-screen.is-shown');
  await page.click('.practice-screen .campaign-go');
  await page.locator(':root[data-screen="flight"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(4500);
  await shot('practice-flight', '.practice-hud');
  await page.keyboard.press('Escape');
  await shown('.pause-screen');
  await shot('practice-pause', '.pause-screen');
  await toModeSelect();
  await openPracticeResultSample(page);
  await shot('practice-result', '.practice-result-screen.is-shown');
  await toModeSelect();
  await openFailedResultSample(page);
  await shot('result-practice-hint', '.result-screen.is-shown:not(.practice-result-screen)');

  // 日替わりチャレンジ（9-9）: 日替わりの画面（連携していなければランキングの欄なし）
  await toModeSelect();
  await page.click('.mode-card[data-mode="daily"]');
  await shown('.daily-screen');
  await shot('daily', '.daily-screen.is-shown');

  // 記録カードの画面
  await toModeSelect();
  await openCardSample(page);
  await shot('card', '.card-overlay');
}

let outDir = '.';
export function setScreensOut(dir) {
  outDir = dir;
}
const shotPath = (size, name) => `${outDir}/${size.name}-${name}.png`;

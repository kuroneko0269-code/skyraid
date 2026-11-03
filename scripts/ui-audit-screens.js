/* global document, setTimeout */
// UI の点検の続き（8-6d）: scripts/ui-audit.js の 3 サイズのそれぞれで、メニューの残りの画面・タブ・ダイアログも撮って、
// 横スクロール（hscrollEl）とフォント（serif）を含む機械チェックをする（audit-inspect.js）。
// キャンペーン（ミッション一覧・ブリーフィング）・リングレース・フリーフライト / レイド / 防衛戦のダイアログ・ハンガー（性能・塗装の
// 翼 / 尾翼）・リプレイ・PvP のロビー・セーブデータの削除の確認・記録カードの画面・設定のデータ（オンライン連携中・メンバー管理の
// 見本。環境変数なしでも画面の部品を作って差し込む）・メンバーの取り消しの確認
import { L } from './audit-lang.js';

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
async function openCardSample(page) {
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

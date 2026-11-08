/* global document */
// 点検の見本の画面（9-9c）: 飛ばずに中身のある画面を出す（scripts/ui-audit-layout.js・ui-audit-device-rotate.js）

/** 見本のリプレイ 14 本（自動 10・保存 4）でリプレイの一覧を開く */
export async function openReplaySample(page) {
  await page.evaluate(async () => {
    const { ReplayListScreen } = await import('/src/ui/replay-list.ts');
    const noop = () => undefined;
    const screen = new ReplayListScreen(document.body, {
      onPlay: noop,
      onSave: noop,
      onRename: noop,
      onExport: noop,
      onDelete: noop,
      onImport: noop,
      onBack: noop,
    });
    const modes = ['mission', 'race', 'raid', 'defense', 'free', 'practice', 'mission'];
    const entries = Array.from({ length: 14 }, (_, i) => ({
      id: 100 - i,
      kind: i < 4 ? 'saved' : 'auto',
      name: i < 4 ? `BEST RUN ${i + 1}` : '',
      size: 8000 + i * 731,
      header: {
        format: 1,
        simVersion: 999,
        date: new Date(Date.UTC(2026, 10, 5, 12, 0) - i * 3600e3).toISOString(),
        pilotName: 'ACE',
        title: '',
        steps: 60 * (95 + i * 17),
        outcome: { result: 'cleared', rank: 'A' },
        startHash: '',
        mode: modes[i % modes.length],
        missionId: 'first-sortie',
        courseId: 'coast',
        mapId: 'island',
        drill: 'static',
        aircraftId: 'kestrel',
        seed: 1,
      },
    }));
    screen.update(entries, { savedCount: 4, savedBytes: 40000, autoCount: 10, autoBytes: 90000 });
    screen.setShown(true);
  });
}

/**
 * 回転の点検（9-9c）用: 飛行中・オンライン連携・ロビーの部屋の中でしか作られない部品を作っておく（中身は最小限。
 * 出すのは rotate-coverage.js の forceShow）。PvP の HUD・ロビーのハンガー / QR・レイドのブリーフィング・保存の選択・ランキング
 */
export async function buildOverlaySamples(page) {
  await page.evaluate(async () => {
    const root = document.body;
    const noop = () => undefined;
    const { PvpBoard } = await import('/src/ui/pvp-board.ts');
    const { PvpOverlay } = await import('/src/ui/pvp-overlay.ts');
    const { PvpHud } = await import('/src/ui/pvp-hud.ts');
    const { LobbyHangar } = await import('/src/ui/lobby-hangar.ts');
    const { LobbyShare } = await import('/src/ui/lobby-share.ts');
    const { RaidBriefing } = await import('/src/ui/raid-briefing.ts');
    const { Kaiju2Briefing } = await import('/src/ui/kaiju2-briefing.ts');
    const { AlbionBriefing } = await import('/src/ui/albion-briefing.ts');
    const { GouraiBriefing } = await import('/src/ui/gourai-briefing.ts');
    const { XenolithBriefing } = await import('/src/ui/xenolith-briefing.ts');
    const { RankingScreen } = await import('/src/ui/ranking-screen.ts');
    const { askSaveChoice } = await import('/src/ui/sync-dialog.ts');
    new PvpBoard(root);
    new PvpOverlay(root);
    new PvpHud(root, { onContinue: noop, onLeave: noop, onChat: noop }, false);
    new LobbyHangar(root, noop);
    new LobbyShare(document.createElement('div'), root);
    new RaidBriefing(root, noop).reset();
    new Kaiju2Briefing(root).show('normal');
    new AlbionBriefing(root).show('normal');
    new GouraiBriefing(root).show('normal');
    new XenolithBriefing(root).show('normal');
    const source = { ranking: () => Promise.resolve([]), selfId: null };
    new RankingScreen(root, source, noop);
    const save = { pilotName: 'ACE', credits: 1000, missions: {} };
    void askSaveChoice(root, save, '2026-11-01T00:00:00Z', {
      data: save,
      updatedAt: '2026-11-02T00:00:00Z',
    });
  });
}

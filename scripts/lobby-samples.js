/* global document */
// 9-10d: ロビーの部屋の画面の見本（通信しない。ui-audit-screens.js・ui-audit-layout.js・回転の点検が使う）
/**
 * 9-10d: ロビーの部屋の画面を見本で出す（通信しない）。variant: host-ffa（ホスト・個人戦 3 人）/ guest-ffa（参加者）/
 * host-team（ホスト・チーム戦 4 人。1 人は再接続中）/ host-raid（協力レイド 2 人）/ guest-defense（協力防衛戦の参加者）
 */
export async function openLobbySample(page, variant = 'host-ffa') {
  await page.evaluate(async (variant) => {
    const { LobbyScreen } = await import('/src/ui/lobby.ts');
    const { NET_CONFIG } = await import('/src/data/net.ts');
    const { findMap } = await import('/src/data/maps.ts');
    const noop = () => undefined;
    const screen = new LobbyScreen(document.body, {
      onCreate: noop,
      onJoin: noop,
      onBack: noop,
      onAgain: noop,
      onAircraft: noop,
      onStart: noop,
      onLeave: noop,
      onHangar: noop,
      onReady: noop,
      onSettings: noop,
      onTeam: noop,
      onAutoTeams: noop,
      onChat: noop,
    });
    const paint = { scheme: 0, colors: [0, 0, 0], decal: 0, decalColor: 0 };
    const player = (id, name, aircraftId, team, ready, away = false) => ({
      id,
      name,
      aircraftId,
      paint,
      maxHp: 100,
      team,
      ready,
      again: false,
      away,
    });
    const all = [
      player(0, 'ACE', 'kestrel', 0, false),
      player(1, 'RAVEN', 'swift', 1, true),
      player(2, 'MOTH-KAZUSA', 'bastion', 0, false),
      player(3, 'ORCA', 'vector', 1, true, true),
    ];
    const v = {
      'host-ffa': { host: true, n: 3, mode: 'ffa' },
      'guest-ffa': { host: false, n: 3, mode: 'ffa' },
      'host-team': { host: true, n: 4, mode: 'team' },
      'host-raid': { host: true, n: 2, mode: 'raid' },
      'guest-defense': { host: false, n: 3, mode: 'defense' },
    }[variant];
    const settings = { ...NET_CONFIG.defaultSettings, mode: v.mode };
    if (v.mode === 'raid') settings.mapId = 'harbor';
    screen.setMode(v.mode === 'raid' ? 'raid' : v.mode === 'defense' ? 'defense' : 'pvp');
    screen.showRoom({
      code: 'K7QX4M',
      joinUrl: 'https://example.com/?room=K7QX4M',
      isHost: v.host,
      localId: v.host ? 0 : 2,
      players: all.slice(0, v.n),
      mapName: findMap(settings.mapId).name,
      settings,
    });
    screen.setShown(true);
    if (variant === 'host-ffa') screen.showChat(1, 0);
  }, variant);
}

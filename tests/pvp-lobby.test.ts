import { describe, expect, it } from 'vitest';
import { PVP_CONFIG } from '../src/data/pvp';
import { ClientRoom } from '../src/net/client-room';
import { startBlock } from '../src/net/lobby-rules';
import { netLoadout } from '../src/net/loadout';
import { buildJoinUrl, withoutRoomParam } from '../src/ui/pvp-entry';
import { rosterNotices } from '../src/ui/pvp-lobby-actions';
import { createLobby, profile, pump } from './net-helpers';
import { startMatch } from './pvp-match';

const UPGRADED = { engine: 3, airframe: 4, weapons: 2, avionics: 1 };

describe('ロビー（5-4。インメモリ transport）', () => {
  it('クライアントの Ready がホストに届き、全員そろうと開始できる。抜けると名簿から消える', async () => {
    const { net, host, clients } = await createLobby(2, { latencyMs: 30 });
    const rooms = [host, ...clients];
    const [a, b] = clients;
    if (!a || !b) throw new Error('clients');
    expect(startBlock(host.players, host.settings.mode)).toBe('ready');
    a.setLobby({ ready: true });
    await pump(net, 100, rooms);
    expect(host.players.find((p) => p.id === a.localPlayerId)?.ready).toBe(true);
    expect(startBlock(host.players, host.settings.mode)).toBe('ready');
    b.setLobby({ ready: true });
    await pump(net, 100, rooms);
    expect(startBlock(host.players, host.settings.mode)).toBeNull();
    // クライアントの画面にも同じ名簿（全員 Ready）が届く
    expect(startBlock(a.players, a.settings.mode)).toBeNull();
    b.setLobby({ ready: false });
    await pump(net, 100, rooms);
    expect(startBlock(host.players, host.settings.mode)).toBe('ready');
  });

  it('強化の無効（初期 ON）で最大 HP は Lv 0 の値。OFF にするとシングルの強化の値', async () => {
    const { net, host } = await createLobby(0);
    expect(host.settings.noUpgrades).toBe(true);
    const c = await (async () => {
      const p = ClientRoom.join(host.code, {
        open: net.open,
        profile: { ...profile('UP', 'bastion'), upgrades: UPGRADED },
        now: () => net.now,
      });
      await pump(net, 200, [host]);
      return p;
    })();
    const base = netLoadout('bastion', undefined).flight.hull.maxHp;
    const up = netLoadout('bastion', UPGRADED).flight.hull.maxHp;
    expect(up).toBeGreaterThan(base);
    expect(host.players.find((p) => p.id === c.localPlayerId)?.maxHp).toBe(base);
    host.setSettings({ ...host.settings, noUpgrades: false });
    await pump(net, 100, [host, c]);
    expect(c.players.find((p) => p.id === c.localPlayerId)?.maxHp).toBe(up);
    expect(c.settings.noUpgrades).toBe(false);
  });

  it('ロビーで機体を変えると名簿の機体と最大 HP が変わる（ホストもクライアントも）', async () => {
    const { net, host, clients } = await createLobby(1);
    const c = clients[0];
    if (!c) throw new Error('client');
    c.setLobby({ profile: profile('P1', 'swift') });
    host.updateHost({ profile: profile('HOST', 'bastion') });
    await pump(net, 100, [host, c]);
    const swift = netLoadout('swift', undefined).flight.hull.maxHp;
    expect(host.players.find((p) => p.id === 1)).toMatchObject({
      aircraftId: 'swift',
      maxHp: swift,
    });
    expect(host.joinProfiles.get(1)?.aircraftId).toBe('swift');
    expect(c.players.find((p) => p.id === 0)?.aircraftId).toBe('bastion');
  });

  it('チーム戦にすると自動で A・B に分かれ、ホストが入れ替えられる', async () => {
    const { net, host, clients } = await createLobby(3);
    host.setSettings({ ...host.settings, mode: 'team' });
    await pump(net, 100, [host, ...clients]);
    expect(host.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    host.setTeam(1, 0);
    await pump(net, 100, [host, ...clients]);
    expect(clients[0]?.players.map((p) => p.team)).toEqual([0, 0, 0, 1]);
    host.autoAssignTeams();
    await pump(net, 100, [host, ...clients]);
    expect(clients[2]?.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
  });

  it('定型文はホストを通って全員に届く（同じ人は 1 秒に 1 回まで・範囲外の番号は捨てる）', async () => {
    const { net, host, clients } = await createLobby(2, { latencyMs: 20 });
    const got: [number, number, number][] = [];
    [host, ...clients].forEach((r, who) => {
      r.onChat((from, phrase) => got.push([who, from, phrase]));
    });
    clients[0]?.chat(2);
    clients[0]?.chat(3);
    clients[1]?.chat(99);
    host.chat(0);
    await pump(net, 200, [host, ...clients]);
    // P1 の「もう一戦」（2）とホストの「準備OK」（0）が 3 人に。続けて送った 3 と範囲外は捨てる
    expect(got.filter(([, from]) => from === 1).map(([w, , p]) => [w, p])).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(got.filter(([, from]) => from === 0)).toHaveLength(3);
    expect(got.some(([, , p]) => p === 3 || p === 99)).toBe(false);
    await pump(net, PVP_CONFIG.chat.minIntervalSeconds * 1000, [host, ...clients]);
    clients[0]?.chat(3);
    await pump(net, 100, [host, ...clients]);
    expect(got.filter(([, , p]) => p === 3)).toHaveLength(3);
  });

  it('対戦が終わると準備と「もう一度」がやり直しになり、全員が押すとそろう', async () => {
    const m = await startMatch(2, { latencyMs: 20 }, { timeLimitSeconds: 2 });
    const rooms = [m.lobby.host, ...m.lobby.clients];
    await m.run(3);
    expect(m.host.finished).toBe(true);
    await pump(m.lobby.net, 100, rooms);
    for (const r of rooms) {
      expect(r.started).toBe(false);
      expect(r.players.every((p) => !p.again)).toBe(true);
      expect(r.players.filter((p) => p.id !== 0).every((p) => !p.ready)).toBe(true);
    }
    m.lobby.clients[0]?.setLobby({ again: true, ready: true });
    m.lobby.host.updateHost({ again: true });
    await pump(m.lobby.net, 100, rooms);
    const c2 = m.lobby.clients[1];
    expect(c2?.players.filter((p) => p.again)).toHaveLength(2);
    c2?.setLobby({ again: true, ready: true });
    await pump(m.lobby.net, 100, rooms);
    expect(c2?.players.every((p) => p.again)).toBe(true);
    // 「もう一度」で準備も済むので、ホストはすぐ開始できる
    expect(startBlock(m.lobby.host.players, 'ffa')).toBeNull();
  });

  it('名簿の変化のお知らせ（切断・再接続・離脱。自分と最初の名簿は出さない）', () => {
    const p = (id: number, away = false) => ({
      id,
      name: `P${id}`,
      aircraftId: 'kestrel',
      maxHp: 1,
      team: 0,
      ready: false,
      again: false,
      away,
    });
    expect(rosterNotices(new Map(), [p(0), p(1)], 0)).toEqual([]);
    const prev = new Map([
      [0, { name: 'P0', away: false }],
      [1, { name: 'P1', away: false }],
      [2, { name: 'P2', away: true }],
      [3, { name: 'P3', away: false }],
    ]);
    expect(rosterNotices(prev, [p(0, true), p(1, true), p(2)], 0)).toEqual([
      'P1 の接続が切れました（再接続を待っています）',
      'P2 が戻りました',
      'P3 が離脱しました',
    ]);
  });

  it('参加用 URL は ?room=コード（?net=local だけ残す）。読み込み後は ?room を消す', () => {
    expect(buildJoinUrl('https://x.pages.dev/?netdebug#a', 'ABCDEF')).toBe(
      'https://x.pages.dev/?room=ABCDEF',
    );
    expect(buildJoinUrl('http://localhost:5173/?net=local&room=OLDOLD', 'ZZZZZZ')).toBe(
      'http://localhost:5173/?room=ZZZZZZ&net=local',
    );
    expect(withoutRoomParam('https://x.pages.dev/?room=ABCDEF&netdebug')).toBe(
      'https://x.pages.dev/?netdebug',
    );
  });
});

describe('開始前のカウントダウン（5-4）', () => {
  it('3 秒の間は操作・射撃を無視して全員止まり、終わったら同時に動き出す', async () => {
    const m = await startMatch(1, { latencyMs: 30 }, {}, PVP_CONFIG.countdownSeconds);
    const host0 = { ...m.owns[0]?.state.position };
    const client0 = { ...m.owns[1]?.state.position };
    const full = (): void => {
      for (const c of m.controls) {
        c.pitch = 1;
        c.roll = 1;
        c.throttle = 1;
        c.afterburner = true;
      }
      for (const c of m.combat) {
        c.fire = true;
        c.missile = true;
        c.flare = true;
      }
    };
    // カウントダウンの 3 秒（クライアントは開始の知らせの分だけ遅れて始まる）
    await m.run(PVP_CONFIG.countdownSeconds - 0.1, full);
    expect(m.host.countdownRemaining).toBeGreaterThan(0);
    expect(m.host.inputBlocked).toBe(true);
    expect(m.owns[0]?.state.position).toEqual(host0);
    expect(m.owns[1]?.state.position).toEqual(client0);
    expect(m.clients[0]?.seq).toBe(0);
    expect(m.host.lastInputSeq(1)).toBe(0);
    expect(m.host.arena.missiles.missiles.count).toBe(0);
    expect(m.events[0]?.filter((e) => e.kind === 'fire' || e.kind === 'flare')).toEqual([]);
    expect(m.host.match.elapsed).toBe(0);
    await m.run(1, full);
    expect(m.host.countdownRemaining).toBe(0);
    expect(m.host.match.elapsed).toBeGreaterThan(0);
    expect(m.owns[0]?.state.position).not.toEqual(host0);
    expect(m.clients[0]?.seq).toBeGreaterThan(0);
    expect(m.events[0]?.some((e) => e.kind === 'fire')).toBe(true);
  });
});

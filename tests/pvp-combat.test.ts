import { describe, expect, it } from 'vitest';
import { createCombatInput, type CombatInput } from '../src/combat/combat-input';
import { accuracy } from '../src/combat/pvp-rules';
import { createControls, Aircraft, type AircraftControls } from '../src/entities/aircraft';
import { rotateVec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';
import { ClientGame } from '../src/net/client-game';
import { HostGame } from '../src/net/host-game';
import { netLoadout } from '../src/net/loadout';
import type { NetGame } from '../src/net/net-game';
import { PvpMirror } from '../src/net/pvp-mirror';
import type { EventMsg, ScoreMsg } from '../src/net/protocol';
import { createLobby, seeded } from './net-helpers';
import { pursue } from './pvp-bots';

const DT = 1 / 60;
const TICK_MS = 1000 / 60;
const KESTREL = netLoadout('kestrel', undefined);

function session(): FlightSession {
  const s = new FlightSession({ rng: seeded(3) });
  s.applyLoadout(KESTREL);
  s.startFree();
  s.configureEnemies(false, 'normal');
  return s;
}

const right = { x: 0, y: 0, z: 0 };
const v2 = { x: 0, y: 0, z: 0 };
/** バンク bankRad で高度 altitude を保って旋回する操作 */
function circle(out: AircraftControls, a: Aircraft, bankRad: number, altitude: number): void {
  rotateVec3(right, a.state.orientation, { x: 1, y: 0, z: 0 });
  const bank = Math.asin(Math.max(-1, Math.min(1, -right.y)));
  out.roll = Math.max(-1, Math.min(1, 2 * (bankRad - bank)));
  const vy = a.velocity(v2).y;
  const climb = 0.004 * (altitude - a.state.position.y) - 0.02 * vy + 0.3 * Math.abs(bank);
  out.pitch = Math.max(-0.5, Math.min(0.8, climb));
  out.throttleTarget = 0.6;
}

interface Duel {
  host: HostGame;
  client: ClientGame;
  hostMirror: PvpMirror;
  clientMirror: PvpMirror;
  hostSession: FlightSession;
  clientSession: FlightSession;
  hostEvents: EventMsg[];
  clientEvents: EventMsg[];
  clientScores: ScoreMsg[];
  hostControls: AircraftControls;
  clientControls: AircraftControls;
  hostInput: CombatInput;
  clientInput: CombatInput;
  /** seconds 秒進める。each(k) でそのステップの操作（hostControls など）を書く */
  run(seconds: number, each: (k: number) => void): void;
}

/** ホスト 1 + クライアント 1。どちらも FlightSession の機体で飛び、表示（PvpMirror）を通す */
async function duel(
  latencyMs: number,
  settings?: { timeLimitSeconds: number; scoreLimit: number },
): Promise<Duel> {
  const lobby = await createLobby(1, { latencyMs, lossRate: 0, jitterMs: 0 }, 7);
  const room = lobby.host;
  const croom = lobby.clients[0];
  if (!croom) throw new Error('no client');
  if (settings) room.setSettings({ ...room.settings, ...settings });
  const hostSession = session();
  const clientSession = session();
  const started: { game: ClientGame | null } = { game: null };
  croom.onStart(() => {
    started.game = new ClientGame(
      croom,
      { own: clientSession.aircraft, countdownSeconds: 0 },
      () => lobby.net.now,
    );
  });
  room.start();
  const host = new HostGame(
    room,
    { own: hostSession.aircraft, rng: seeded(9), countdownSeconds: 0 },
    () => lobby.net.now,
  );
  for (let i = 0; i < 20 && !started.game; i++) {
    lobby.net.advance(10);
    await Promise.resolve();
  }
  const c = started.game;
  if (!c) throw new Error('client game not started');
  const hostMirror = new PvpMirror(hostSession, 0);
  const clientMirror = new PvpMirror(clientSession, c.localId);
  hostMirror.syncRoster(room.players);
  clientMirror.syncRoster(croom.players);
  const hostEvents: EventMsg[] = [];
  const clientEvents: EventMsg[] = [];
  const clientScores: ScoreMsg[] = [];
  host.onEvent((e) => {
    hostEvents.push({ ...e });
    hostMirror.handleEvent(e);
  });
  c.onEvent((e) => {
    clientEvents.push({ ...e });
    clientMirror.handleEvent(e);
  });
  c.onScore((s) => clientScores.push(s));
  const hostControls = createControls();
  const clientControls = createControls();
  const hostInput = createCombatInput();
  const clientInput = createCombatInput();
  let k = 0;
  const step = (game: NetGame, mirror: PvpMirror, ctl: AircraftControls, input: CombatInput) => {
    const l = mirror.stepLocal(input, DT);
    game.step(ctl, l, DT);
    mirror.stepWorld(game, DT);
    mirror.updateRivals(game.samples(0, lobby.net.now));
  };
  const run = (seconds: number, each: (k: number) => void): void => {
    const end = k + Math.round(seconds * 60);
    while (k < end) {
      k++;
      lobby.net.advance(TICK_MS);
      room.tick();
      croom.tick();
      Object.assign(hostControls, createControls());
      Object.assign(clientControls, createControls());
      Object.assign(hostInput, createCombatInput());
      Object.assign(clientInput, createCombatInput());
      each(k);
      step(host, hostMirror, hostControls, hostInput);
      step(c, clientMirror, clientControls, clientInput);
    }
  };
  return {
    host,
    client: c,
    hostMirror,
    clientMirror,
    hostSession,
    clientSession,
    hostEvents,
    clientEvents,
    clientScores,
    hostControls,
    clientControls,
    hostInput,
    clientInput,
    run,
  };
}

describe('PvP: ホストの判定とクライアントの表示（インメモリ transport）', () => {
  it('2 人が 60 秒撃ち合い、命中の回数がホストとクライアントの表示で一致する', async () => {
    const d = await duel(60);
    const hostRival = d.hostMirror.rivals.get(d.client.localId);
    const clientRival = d.clientMirror.rivals.get(0);
    if (!hostRival || !clientRival) throw new Error('rival');
    d.run(60, () => {
      const ha = pursue(d.hostControls, d.hostSession.aircraft, hostRival);
      const ca = pursue(d.clientControls, d.clientSession.aircraft, clientRival);
      d.hostInput.trigger = ha < 3;
      d.clientInput.trigger = ca < 3;
    });
    // 撃ち終えてから、届いていない event を流しきる
    d.run(1, () => undefined);
    const fighters = d.host.arena.all;
    const totalHits = fighters.reduce((n, f) => n + f.hits, 0);
    expect(totalHits).toBeGreaterThan(20);
    for (const f of fighters) {
      expect(d.clientMirror.hitsBy.get(f.id) ?? 0).toBe(f.hits);
      expect(d.hostMirror.hitsBy.get(f.id) ?? 0).toBe(f.hits);
    }
    // 成績のメッセージの命中数・撃墜数も同じ
    const last = d.clientScores[d.clientScores.length - 1];
    for (const f of fighters) {
      const s = last?.players.find((p) => p.id === f.id);
      expect(s?.hits).toBe(f.hits);
      expect(s?.kills).toBe(f.kills);
      expect(s?.deaths).toBe(f.deaths);
    }
    // 撃墜・復帰も起きて、クライアントの自機の HP の表示はホストと同じ
    expect(fighters.reduce((n, f) => n + f.deaths, 0)).toBeGreaterThan(0);
    const own = fighters.find((f) => f.id === d.client.localId);
    expect(d.clientSession.player.active).toBe(own?.alive);
    if (own?.alive) expect(d.clientSession.player.hp).toBe(Math.max(1, own.hp));
  }, 60000);

  /** クライアントが円を描くホストを後ろから撃つ。命中率（ホストの判定）を返す */
  async function chaseAccuracy(lag: boolean): Promise<number> {
    const d = await duel(100);
    d.host.arena.lagCompensation = lag;
    const rival = d.clientMirror.rivals.get(0);
    if (!rival) throw new Error('rival');
    // ホストを前、クライアントを 400m 後ろに置く（同じ向き）
    const hostA = d.hostSession.aircraft;
    const cliA = d.clientSession.aircraft;
    const id = d.client.localId;
    const remote = d.host.aircraftOf(id);
    if (!remote) throw new Error('remote');
    const start = { x: 0, y: 1500, z: 0 };
    hostA.respawn(start, null);
    for (const a of [cliA, remote]) a.respawn({ x: 0, y: 1500, z: 400 }, null);
    d.run(30, (k) => {
      // ホストは高度 1500m でゆるく旋回する（左右を 8 秒ごとに切り替える）
      circle(d.hostControls, hostA, Math.floor(k / 480) % 2 === 0 ? 0.5 : -0.5, 1500);
      const off = pursue(d.clientControls, cliA, rival);
      d.clientInput.trigger = k > 120 && off < 2;
    });
    const f = d.host.arena.fighters.get(id);
    if (!f) throw new Error('fighter');
    // 巻き戻し = 撃った人が見ていた時刻の差 ≈ RTT 200 + 補間の遅れ 100 + ホストの入力の溜め 100（ms）
    const rewind = d.host.stats(0).rewindMs;
    expect(rewind).toBeGreaterThan(350);
    expect(rewind).toBeLessThan(470);
    expect(f.shots).toBeGreaterThan(50);
    return accuracy(f);
  }

  it('RTT 200ms のとき、遅延補償ありの命中率は補償なしより高い', async () => {
    const withLag = await chaseAccuracy(true);
    const without = await chaseAccuracy(false);
    // 補償なしは相手の表示が RTT + 補間の遅れだけ古い位置を撃つので、ほとんど当たらない
    expect(withLag).toBeGreaterThan(without * 2);
    expect(withLag).toBeGreaterThan(0.08);
  }, 60000);

  it('制限時間で終わり、成績（over）と終了の event が届き、部屋はロビーに戻る', async () => {
    const d = await duel(50, { timeLimitSeconds: 2, scoreLimit: 10 });
    d.run(3, () => undefined);
    expect(d.host.finished).toBe(true);
    expect(d.clientEvents.some((e) => e.kind === 'over')).toBe(true);
    expect(d.clientScores.some((s) => s.over)).toBe(true);
    expect(d.hostEvents.some((e) => e.kind === 'over')).toBe(true);
  }, 30000);
});

import { describe, expect, it } from 'vitest';
import { AIRCRAFT_MODELS } from '../src/data/aircraft';
import { Aircraft, createControls, type AircraftControls } from '../src/entities/aircraft';
import { ClientGame } from '../src/net/client-game';
import { HostGame } from '../src/net/host-game';
import { resolveLoadout } from '../src/progression/loadout';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import { createLobby } from './net-helpers';

const DT = 1 / 60;
const TICK_MS = 1000 / 60;

function kestrel(): Aircraft {
  const model = AIRCRAFT_MODELS[0];
  if (!model) throw new Error('no model');
  const levels = { engine: 0, airframe: 0, weapons: 0, avionics: 0 };
  return new Aircraft(resolveLoadout(model, levels).flight);
}

/**
 * プレイヤー i の時刻 t の操作: 左右 ±40° のバンクで旋回を繰り返し、高度 800m 付近を保つ（自分の機体を見て操作する。
 * 墜落のリセットが入ると位置が飛ぶので、平らな地面（高度 0）に落ちない操作にする）
 */
const right = { x: 0, y: 0, z: 0 };
const vel = { x: 0, y: 0, z: 0 };
function fly(out: AircraftControls, a: Aircraft, i: number, t: number): AircraftControls {
  rotateVec3(right, a.state.orientation, { x: 1, y: 0, z: 0 });
  const bank = Math.asin(Math.max(-1, Math.min(1, -right.y)));
  const target = 0.7 * Math.sin(0.25 * t + i * 1.7);
  out.roll = Math.max(-1, Math.min(1, 2 * (target - bank)));
  const vy = a.velocity(vel).y;
  const climb = 0.004 * (800 - a.state.position.y) - 0.02 * vy + 0.3 * Math.abs(bank);
  out.pitch = Math.max(-0.5, Math.min(0.8, climb));
  out.yaw = 0.2 * Math.sin(0.8 * t + i * 0.5);
  out.throttle = Math.sin(0.1 * t + i) > 0.6 ? 1 : 0;
  out.afterburner = Math.sin(0.2 * t + i * 2) > 0.8;
  return out;
}

function copy(v: Readonly<Vec3>): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface Result {
  remoteWorst: number;
  ownWorst: number;
  samples: number;
  ownCompared: number;
  crashes: number;
  corrections: number;
  guessed: number;
  starved: number;
}

/** ホスト 1 + クライアント 3 を seconds 秒飛ばし、各クライアントの表示とホストの正の位置のずれを測る */
async function simulate(
  seconds: number,
  net: { latencyMs: number; lossRate: number; jitterMs: number },
  seed = 1,
): Promise<Result> {
  const lobby = await createLobby(3, net, seed);
  const { host, clients } = lobby;
  const hostOwn = kestrel();
  const owns = clients.map(() => kestrel());
  const games: (ClientGame | null)[] = clients.map(() => null);
  clients.forEach((c, i) => {
    c.onStart(() => {
      games[i] = new ClientGame(c, { own: owns[i] ?? kestrel() }, () => lobby.net.now);
    });
  });
  host.start();
  const hostGame = new HostGame(host, { own: hostOwn, ownHp: () => 100 }, () => lobby.net.now);
  // ホストの正: tick ごとの全機の位置、参加者の機体に使った入力の seq ごとの位置
  const truth: Vec3[][] = [[], [], [], []];
  const hostBySeq = [0, 1, 2, 3].map(() => new Map<number, Vec3>());
  const clientBySeq = clients.map(() => new Map<number, Vec3>());
  const controls = [createControls(), createControls(), createControls(), createControls()];
  let remoteWorst = 0;
  let ownWorst = 0;
  let samples = 0;
  const warmup = 3 * 60;
  const ticks = seconds * 60;
  for (let k = 1; k <= ticks; k++) {
    lobby.net.advance(TICK_MS);
    host.tick();
    for (const c of clients) c.tick();
    const t = k * DT;
    hostGame.step(fly(controls[0] ?? createControls(), hostOwn, 0, t), DT);
    for (let id = 0; id < 4; id++) {
      const a = hostGame.aircraftOf(id);
      if (a) (truth[id] ?? [])[hostGame.tick] = copy(a.state.position);
      if (a && id > 0) hostBySeq[id]?.set(hostGame.lastInputSeq(id), copy(a.state.position));
    }
    games.forEach((g, i) => {
      if (!g) return;
      g.step(fly(controls[i + 1] ?? createControls(), owns[i] ?? hostOwn, i + 1, t), DT);
      clientBySeq[i]?.set(g.seq, copy(owns[i]?.state.position ?? { x: 0, y: 0, z: 0 }));
    });
    if (k < warmup) continue;
    // 各クライアントの他機の表示 vs その表示時刻のホストの正
    for (const g of games) {
      if (!g) continue;
      const list = g.samples(0, lobby.net.now);
      const tt = (g.renderTime ?? 0) * 60;
      for (const s of list) {
        const i0 = Math.floor(tt);
        const a = truth[s.id]?.[i0];
        const b = truth[s.id]?.[i0 + 1];
        if (!a || !b) continue;
        const f = tt - i0;
        const exp = {
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
        };
        remoteWorst = Math.max(remoteWorst, dist(s.position, exp));
        samples++;
      }
    }
  }
  // 自機の先行計算 vs 同じ seq を使ったホストの位置
  let ownCompared = 0;
  clients.forEach((c, i) => {
    const id = c.localPlayerId;
    for (const [seq, p] of clientBySeq[i] ?? []) {
      if (seq < warmup) continue;
      const h = hostBySeq[id]?.get(seq);
      if (!h) continue;
      ownWorst = Math.max(ownWorst, dist(p, h));
      ownCompared++;
    }
  });
  const crashes = hostOwn.crashCount + owns.reduce((n, a) => n + a.crashCount, 0);
  const corrections = games.reduce((n, g) => n + (g?.prediction.corrections ?? 0), 0);
  const hs = hostGame.stats(lobby.net.now);
  const { inputGuessed: guessed, inputStarved: starved } = hs;
  return { remoteWorst, ownWorst, samples, ownCompared, crashes, corrections, guessed, starved };
}

describe('net: ホスト 1 + クライアント 3 の同期（インメモリ transport）', () => {
  it('遅延 100ms・ロス 5% で 60 秒、他機の表示と自機の位置の誤差が 5m 以内', async () => {
    const r = await simulate(60, { latencyMs: 100, lossRate: 0.05, jitterMs: 10 });
    // 墜落（地面との衝突でのリセット）なしで飛び続けた
    expect(r.crashes).toBe(0);
    // 3 クライアント × 3 機 × 57 秒 × 60 フレーム近く比べた
    expect(r.samples).toBeGreaterThan(3 * 3 * 55 * 60);
    expect(r.ownCompared).toBeGreaterThan(3 * 55 * 60);
    expect(r.remoteWorst).toBeLessThan(5);
    expect(r.ownWorst).toBeLessThan(5);
  }, 30000);

  it('ロスなしなら自機の先行計算はホストと一致し、補正は入らない', async () => {
    const r = await simulate(20, { latencyMs: 60, lossRate: 0, jitterMs: 0 });
    expect(r.guessed).toBe(0);
    expect(r.corrections).toBe(0);
    expect(r.ownWorst).toBeLessThan(0.01);
    expect(r.remoteWorst).toBeLessThan(1);
  }, 30000);

  it('ロス 30% でホストが入力を推測で埋めても、自機の補正で 5m 以内に収まる', async () => {
    const r = await simulate(30, { latencyMs: 100, lossRate: 0.3, jitterMs: 30 }, 5);
    expect(r.guessed).toBeGreaterThan(0);
    expect(r.corrections).toBeGreaterThan(0);
    expect(r.ownWorst).toBeLessThan(5);
    expect(r.remoteWorst).toBeLessThan(5);
  }, 30000);
});

import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, readQuat, writeQuat } from '../src/net/codec';
import {
  NO_TARGET,
  createNetControls,
  decodeMessage,
  encodeMessage,
  eventMsg,
  quantizeControls,
  type AircraftStateMsg,
  type MissileStateMsg,
  type NetMessage,
  type StateMsg,
} from '../src/net/protocol';
import { normalizeQuat, type Quat } from '../src/flight/math';

/** 決定的な乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomQuat(r: () => number): Quat {
  return normalizeQuat({ x: r() * 2 - 1, y: r() * 2 - 1, z: r() * 2 - 1, w: r() * 2 - 1 });
}

/** 2 つの回転の角度差（度）。q と -q は同じ回転 */
function angleDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

function roundTrip(msg: NetMessage): NetMessage | null {
  return decodeMessage(encodeMessage(msg));
}

describe('protocol: 直列化の往復', () => {
  it('join / welcome / event / ping はそのまま戻る', () => {
    const msgs: NetMessage[] = [
      {
        type: 'join',
        version: 1,
        name: 'パイロット✈',
        aircraftId: 'swift',
        upgrades: { engine: 1, airframe: 2, weapons: 3, avionics: 5 },
        resumeId: 255,
        token: 0,
      },
      {
        type: 'join',
        version: 3,
        name: 'P2',
        aircraftId: 'kestrel',
        upgrades: { engine: 0, airframe: 0, weapons: 0, avionics: 0 },
        resumeId: 2,
        token: 0xdeadbeef,
      },
      {
        type: 'welcome',
        status: 'ok',
        yourId: 2,
        yourToken: 4000000000,
        inMatch: true,
        settings: {
          mapId: 'island',
          timeLimitSeconds: 300,
          scoreLimit: 10,
          mode: 'team',
          noUpgrades: true,
          rookieGuard: false,
        },
        players: [
          {
            id: 0,
            name: 'HOST',
            aircraftId: 'kestrel',
            maxHp: 200,
            team: 0,
            ready: true,
            again: false,
            away: false,
          },
          {
            id: 2,
            name: 'ゲスト',
            aircraftId: 'bastion',
            maxHp: 1234,
            team: 1,
            ready: false,
            again: true,
            away: true,
          },
        ],
      },
      {
        type: 'welcome',
        status: 'expired',
        yourId: 0,
        yourToken: 0,
        inMatch: false,
        settings: {
          mapId: 'island',
          timeLimitSeconds: 0,
          scoreLimit: 0,
          mode: 'ffa',
          noUpgrades: false,
          rookieGuard: true,
        },
        players: [],
      },
      {
        type: 'lobby',
        ready: true,
        again: false,
        aircraftId: 'vector',
        upgrades: { engine: 5, airframe: 4, weapons: 3, avionics: 2 },
      },
      { type: 'chat', from: 3, phrase: 5 },
      eventMsg('bye', 2, 0, 0),
      eventMsg('kill', 1, 3, 123456, 0, 12.5, -300.25, 4500),
      eventMsg('end', 0, 0, 0),
      eventMsg('respawn', 2, 7, 999, 54321),
      eventMsg('explode', 3, 255, 10, 200, 1, 2, 3),
      {
        type: 'score',
        remainingSeconds: 123.4,
        over: true,
        players: [
          { id: 0, kills: 10, deaths: 3, shots: 4000, hits: 321, bestStreak: 6 },
          { id: 3, kills: 0, deaths: 12, shots: 0, hits: 0, bestStreak: 0 },
        ],
      },
      { type: 'ping', pong: true, nonce: 42, time: 12345.678 },
    ];
    for (const m of msgs) expect(roundTrip(m)).toEqual(m);
  });

  it('input は量子化した値で戻る（量子化した値はもう一度通しても変わらない）', () => {
    const c = createNetControls();
    Object.assign(c, {
      pitch: 0.33,
      roll: -1,
      yaw: 0.5,
      throttle: -0.2,
      throttleTarget: 0.71,
      afterburner: true,
      autoLevel: true,
      invertPitch: false,
      fire: true,
      missile: false,
      flare: true,
      targetNext: false,
      locked: true,
      targetId: 3,
    });
    const q = quantizeControls(createNetControls(), c);
    const back = roundTrip({
      type: 'input',
      seq: 99,
      viewTick: 12345,
      controls: [c, createNetControls()],
    });
    expect(back?.type).toBe('input');
    if (back?.type !== 'input') return;
    expect(back.seq).toBe(99);
    expect(back.viewTick).toBe(12345);
    expect(back.controls[0]).toEqual(q);
    expect(back.controls[1]).toEqual(createNetControls());
    expect(quantizeControls(createNetControls(), q)).toEqual(q);
    expect(Math.abs(q.pitch - 0.33)).toBeLessThan(1 / 127);
  });

  it('state: 位置は float32、速度は 1/16 m/s、姿勢の誤差は 0.01° 未満', () => {
    const r = rng(7);
    const aircraft: AircraftStateMsg[] = [];
    for (let i = 0; i < 4; i++) {
      aircraft.push({
        id: i,
        alive: i !== 2,
        afterburner: i === 1,
        invulnerable: i === 3,
        lastInputSeq: 1000 + i,
        position: { x: r() * 20000 - 10000, y: r() * 9000, z: r() * 20000 - 10000 },
        orientation: randomQuat(r),
        velocity: { x: r() * 600 - 300, y: r() * 200 - 100, z: r() * 600 - 300 },
        speed: 150 + r() * 200,
        throttle: r(),
        hp: Math.round(r() * 300),
      });
    }
    const msg: StateMsg = { type: 'state', tick: 7777, aircraft, missiles: [] };
    const data = encodeMessage(msg);
    // 1 機 37 バイト + 見出し 7 バイト（4 機で 155 バイト。15Hz で約 2.3KB/s）
    expect(data.byteLength).toBe(7 + 37 * 4);
    const back = decodeMessage(data);
    expect(back?.type).toBe('state');
    if (back?.type !== 'state') return;
    expect(back.tick).toBe(7777);
    back.aircraft.forEach((b, i) => {
      const a = aircraft[i];
      if (!a) throw new Error('missing');
      expect(b.id).toBe(a.id);
      expect(b.alive).toBe(a.alive);
      expect(b.afterburner).toBe(a.afterburner);
      expect(b.invulnerable).toBe(a.invulnerable);
      expect(b.lastInputSeq).toBe(a.lastInputSeq);
      expect(b.hp).toBe(a.hp);
      expect(b.position.x).toBeCloseTo(Math.fround(a.position.x), 6);
      expect(Math.abs(b.position.y - a.position.y)).toBeLessThan(0.001);
      expect(Math.abs(b.velocity.x - a.velocity.x)).toBeLessThanOrEqual(1 / 32);
      expect(Math.abs(b.velocity.z - a.velocity.z)).toBeLessThanOrEqual(1 / 32);
      expect(Math.abs(b.speed - a.speed)).toBeLessThan(1e-4);
      expect(Math.abs(b.throttle - a.throttle)).toBeLessThanOrEqual(1 / 510);
      expect(angleDeg(b.orientation, a.orientation)).toBeLessThan(0.01);
    });
  });

  it('state のミサイル: 1 発 14 バイト、位置は 0.5m・速度は 1/16 m/s。4 機 + 16 発で 6KB/s 以下', () => {
    const r = rng(11);
    const aircraft: AircraftStateMsg[] = [];
    for (let i = 0; i < 4; i++) {
      aircraft.push({
        id: i,
        alive: true,
        afterburner: false,
        invulnerable: false,
        lastInputSeq: 100000,
        position: { x: 1, y: 2, z: 3 },
        orientation: randomQuat(r),
        velocity: { x: 300, y: 0, z: 0 },
        speed: 300,
        throttle: 1,
        hp: 200,
      });
    }
    const missiles: MissileStateMsg[] = [];
    for (let i = 0; i < 16; i++) {
      missiles.push({
        netId: 240 + i,
        owner: i % 4,
        targetId: i % 5 === 4 ? NO_TARGET : (i + 1) % 4,
        position: { x: r() * 20000 - 10000, y: r() * 3000, z: r() * 20000 - 10000 },
        velocity: { x: r() * 1400 - 700, y: r() * 1400 - 700, z: r() * 1400 - 700 },
      });
    }
    const data = encodeMessage({ type: 'state', tick: 1, aircraft, missiles });
    expect(data.byteLength).toBe(7 + 37 * 4 + 14 * 16);
    // 15Hz で 6KB/s 以下
    expect(data.byteLength * 15).toBeLessThanOrEqual(6000);
    const back = decodeMessage(data);
    if (back?.type !== 'state') throw new Error('state でない');
    back.missiles.forEach((b, i) => {
      const a = missiles[i];
      if (!a) throw new Error('missing');
      expect(b.netId).toBe(a.netId & 0xff);
      expect(b.owner).toBe(a.owner);
      expect(b.targetId).toBe(a.targetId);
      expect(Math.abs(b.position.x - a.position.x)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(b.position.z - a.position.z)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(b.velocity.y - a.velocity.y)).toBeLessThanOrEqual(1 / 32);
    });
  });

  it('壊れたメッセージは null', () => {
    expect(decodeMessage(new ArrayBuffer(0))).toBeNull();
    expect(decodeMessage(new Uint8Array([99]).buffer)).toBeNull();
    const ok = encodeMessage({ type: 'ping', pong: false, nonce: 1, time: 2 });
    expect(decodeMessage(ok.slice(0, ok.byteLength - 1))).toBeNull();
    const longer = new Uint8Array(ok.byteLength + 1);
    longer.set(new Uint8Array(ok));
    expect(decodeMessage(longer.buffer)).toBeNull();
  });
});

describe('codec: smallest-three の圧縮誤差', () => {
  it('ランダムな 10000 個の姿勢で最大誤差 0.01° 未満、単位長さを保つ', () => {
    const r = rng(1);
    let worst = 0;
    for (let i = 0; i < 10000; i++) {
      const q = randomQuat(r);
      const w = new ByteWriter();
      writeQuat(w, q);
      const buf = w.finish();
      expect(buf.byteLength).toBe(6);
      const back = readQuat(new ByteReader(buf), { x: 0, y: 0, z: 0, w: 1 });
      worst = Math.max(worst, angleDeg(q, back));
      expect(Math.hypot(back.x, back.y, back.z, back.w)).toBeCloseTo(1, 6);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('軸に沿った姿勢・符号が負の最大成分も戻る', () => {
    const cases: Quat[] = [
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: 0, w: -1 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: -1, z: 0, w: 0 },
      normalizeQuat({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 }),
      normalizeQuat({ x: -0.7, y: 0.1, z: 0.7, w: 0.1 }),
    ];
    for (const q of cases) {
      const w = new ByteWriter();
      writeQuat(w, q);
      const back = readQuat(new ByteReader(w.finish()), { x: 0, y: 0, z: 0, w: 1 });
      expect(angleDeg(q, back)).toBeLessThan(0.01);
    }
  });
});

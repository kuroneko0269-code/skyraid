// 10-2: 協力レイドの怪獣ごとの差し込み口（src/net/raid-plugin.ts）: 登録した怪獣はホストが進め、state の欄とできごと（kx）が
// クライアントに届き、終わりと成績が全員で一致する。登録が無ければ今までの怪獣のまま（ヴォルガスの RaidHost）
import { afterEach, describe, expect, it } from 'vitest';
import { RAID_OUTCOME } from '../src/net/raid-host';
import {
  registerRaidPlugin,
  unregisterRaidPlugin,
  type RaidPluginHost,
} from '../src/net/raid-plugin';
import {
  decodeMessage,
  encodeMessage,
  type GameSettings,
  type StateMsg,
} from '../src/net/protocol';
import { startMatch } from './pvp-match';
import { SeededRandom } from '../src/core/random';
import { vec3 } from '../src/flight/math';
import { MinionSwarm } from '../src/ai/raid-kit/minions';
import { PartSet } from '../src/ai/raid-kit/parts';
import { ByteWriter } from '../src/net/codec';
import {
  SHOT_NOTE_BYTES,
  bytesOf,
  readMinions,
  readParts,
  readShots,
  readerOf,
  shotNote,
  writeMinions,
  writeParts,
  writeShots,
} from '../src/net/raid-kit-codec';

/** 仮の怪獣: 3 秒で倒れる。state は経過 tick の下 2 バイト、1 秒ごとに「子分が出た」できごと */
class DummyHost implements RaidPluginHost {
  ticks = 0;
  private pending: number[] = [];
  readonly targetId = null;

  constructor(readonly seed: number) {}

  step(): void {
    this.ticks++;
    if (this.ticks % 60 === 0) this.pending.push(this.ticks / 60);
  }

  get outcome(): number {
    return this.ticks >= 180 ? RAID_OUTCOME.clear : RAID_OUTCOME.none;
  }

  get remaining(): number {
    return Math.max(0, 600 - this.ticks / 60);
  }

  fields(id: number): { partDamage: number[]; breaks: number } {
    return { partDamage: [id, 2, 3], breaks: 1 };
  }

  state(): Uint8Array {
    return Uint8Array.of((this.ticks >> 8) & 0xff, this.ticks & 0xff);
  }

  takeEvents(): Uint8Array | null {
    if (this.pending.length === 0) return null;
    const out = Uint8Array.from(this.pending);
    this.pending = [];
    return out;
  }
}

afterEach(() => {
  unregisterRaidPlugin('vorgas');
});

describe('10-2: 協力レイドの怪獣ごとの差し込み口', () => {
  it('state の欄と kx のメッセージの往復（無しは 1 バイト）', () => {
    const base: StateMsg = {
      type: 'state',
      tick: 9,
      aircraft: [],
      missiles: [],
      kaiju: null,
      defense: null,
      kaiju2: null,
    };
    const none = encodeMessage(base).byteLength;
    const withExtra = encodeMessage({
      ...base,
      raidExtra: { kaiju: 3, bytes: Uint8Array.of(1, 2, 3) },
    });
    // 怪獣の番号 1 + 長さ 2 + 中身（有無の 1 バイトは無しにもある）
    expect(withExtra.byteLength - none).toBe(1 + 2 + 3);
    const back = decodeMessage(withExtra);
    expect(back?.type === 'state' && back.raidExtra?.kaiju).toBe(3);
    expect(back?.type === 'state' && [...(back.raidExtra?.bytes ?? [])]).toEqual([1, 2, 3]);
    expect(decodeMessage(encodeMessage(base))).toEqual(base);
    const kx = decodeMessage(
      encodeMessage({ type: 'kx', kaiju: 2, tick: 1234, bytes: Uint8Array.of(9, 8) }),
    );
    expect(kx).toEqual({ type: 'kx', kaiju: 2, tick: 1234, bytes: Uint8Array.of(9, 8) });
  });

  it('登録した怪獣はホストが進め、state とできごとがクライアントに届き、終わりが全員で一致する', async () => {
    let made: DummyHost | null = null;
    registerRaidPlugin({
      kaiju: 'vorgas',
      createHost: (ctx) => {
        made = new DummyHost(ctx.seed);
        return made;
      },
      createMirror: () => ({
        receiveState: () => undefined,
        receiveEvents: () => undefined,
        step: () => undefined,
      }),
    });
    const settings: Partial<GameSettings> = { mode: 'raid' };
    const m = await startMatch(1, {}, settings);
    expect(m.host.raid).toBeNull();
    expect(m.host.raidX?.host).toBe(made);
    await m.run(2);
    const c = m.clients[0];
    if (!c) throw new Error('no client');
    expect(c.raidExtra?.kaiju).toBe(0);
    const bytes = c.raidExtra?.bytes ?? new Uint8Array(2);
    const ticks = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
    expect(ticks).toBeGreaterThan(60);
    const events = c.raidEvents.flatMap((e) => [...e.bytes]);
    expect(events.slice(0, 1)).toEqual([1]);
    await m.run(2);
    expect(m.host.finished).toBe(true);
    const over = m.events[1]?.find((e) => e.kind === 'over');
    expect(over?.b).toBe(RAID_OUTCOME.clear);
    expect(m.host.score(true).players[0]?.partDamage).toEqual([0, 2, 3]);
  });

  it('登録が無ければ今までの怪獣（ヴォルガスの RaidHost）', async () => {
    const m = await startMatch(1, {}, { mode: 'raid' });
    expect(m.host.raidX).toBeNull();
    expect(m.host.raid).not.toBeNull();
  });
});

describe('10-2: 共通の部品の協力の直列化（raid-kit-codec.ts）', () => {
  it('部位・子分・弾の往復と大きさ', () => {
    const parts = new PartSet(
      [
        { id: 'body', hpShare: 1, breakable: false },
        { id: 'nest', hpShare: 0.1, breakable: true },
        { id: 'fin', hpShare: 0.1, breakable: true },
      ],
      1000,
    );
    parts.damage(1, 200, 0);
    parts.damage(2, 50, 1);
    const swarm = new MinionSwarm(
      {
        cap: 12,
        firstDelay: 0,
        interval: 10,
        perNest: 12,
        hp: 10,
        speed: 100,
        turnDeg: 60,
        life: 30,
        orbit: 200,
        homeOrbit: 300,
        dropSeconds: 1,
      },
      [{ offset: { forward: 0, right: 0, up: -30 }, part: -1 }],
    );
    const body = { position: vec3(1000, 500, -2000), heading: 0.5 };
    const rng = new SeededRandom(4);
    for (let i = 0; i < 120; i++)
      swarm.step(
        1 / 60,
        body,
        () => false,
        () => null,
        rng.next,
      );
    const w = new ByteWriter();
    writeParts(w, parts);
    writeMinions(w, swarm, body.position);
    const notes = [
      shotNote({
        turret: 3,
        weapon: 'missile',
        origin: vec3(),
        direction: { x: 0, y: 0.5, z: -Math.sqrt(0.75) },
        targetId: 0,
      }),
    ];
    writeShots(w, notes);
    const bytes = bytesOf(w);
    // 部位 3 つ 8 バイト + 子分 12 匹 1 + 12 × 9 + 弾 1 発 1 + 4
    expect(bytes.length).toBe(8 + 1 + 12 * 9 + 1 + SHOT_NOTE_BYTES);
    const r = readerOf(bytes);
    const p = readParts(r);
    expect(p.broken).toBe(0b010);
    expect(p.ratio).toBeCloseTo(0.75, 3);
    expect(p.parts[2]).toBeCloseTo(0.5, 2);
    const ms = readMinions(r, body.position);
    expect(ms).toHaveLength(12);
    swarm.minions.forEach((m, i) => {
      expect(ms[i]?.position.x).toBeCloseTo(m.position.x, 0);
      expect(ms[i]?.position.y).toBeCloseTo(m.position.y, 0);
    });
    const shots = readShots(r);
    expect(shots[0]).toMatchObject({ turret: 3, missile: true });
    expect(shots[0]?.pitchDeg).toBeCloseTo(30, 0);
    expect(r.remaining).toBe(0);
  });
});

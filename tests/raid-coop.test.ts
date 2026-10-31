// レイドの協力（6-2。最小限）: ロビーのモード、state の怪獣、ホストの判定（怪獣の部位への機銃・ミサイル、攻撃した人の ID、
// 怪獣の攻撃の当たり・スタン）、終わり方
import { describe, expect, it } from 'vitest';
import {
  KAIJU_ID_BASE,
  PvpArena,
  type ArenaEvent,
  type PvpControls,
} from '../src/combat/pvp-arena';
import { KAIJU_CONFIG } from '../src/data/kaiju';
import { Aircraft, createControls } from '../src/entities/aircraft';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { Kaiju } from '../src/entities/kaiju';
import { fighterSpec } from '../src/net/host-state';
import { KaijuMirror } from '../src/net/kaiju-mirror';
import { netLoadout } from '../src/net/loadout';
import { sameSide, startBlock } from '../src/net/lobby-rules';
import {
  NO_TARGET,
  decodeMessage,
  encodeMessage,
  type GameSettings,
  type StateMsg,
} from '../src/net/protocol';
import { RAID_OUTCOME, RaidHost } from '../src/net/raid-host';
import { DT, startMatch } from './pvp-match';

const SPEC = fighterSpec(netLoadout('kestrel', undefined));

function controls(over: Partial<PvpControls> = {}): PvpControls {
  return {
    ...createControls(),
    autoLevel: false,
    invertPitch: false,
    fire: false,
    missile: false,
    flare: false,
    locked: false,
    targetId: NO_TARGET,
    ...over,
  };
}

/** 陸に立った怪獣と、その部位を対象にした arena。機体 n 機 */
function raidArena(n: number): { arena: PvpArena; kaiju: Kaiju; events: ArenaEvent[] } {
  const events: ArenaEvent[] = [];
  const arena = new PvpArena(
    (e) => events.push({ ...e }),
    null,
    () => 0.5,
  );
  arena.setTeams(new Map(Array.from({ length: n }, (_, i) => [i, 0])));
  const kaiju = new Kaiju(() => 0);
  kaiju.emerge(0, 0, 0, -1000, { players: n });
  for (let i = 0; i < KAIJU_CONFIG.riseSeconds * 60 + 1; i++) kaiju.step(DT);
  kaiju.finishStep();
  arena.setKaijuParts(kaiju.parts);
  for (let i = 0; i < n; i++) {
    const a = new Aircraft(netLoadout('kestrel', undefined).flight);
    arena.add(i, a, SPEC);
  }
  return { arena, kaiju, events };
}

/** 機体 id を部位の右（+X 側）distance m・同じ高さに、部位へ機首を向けて置く */
function aimAt(arena: PvpArena, id: number, kaiju: Kaiju, part: number, distance: number): void {
  const p = kaiju.parts[part]?.position;
  const f = arena.fighters.get(id);
  if (!p || !f) throw new Error('no target');
  f.aircraft.respawn(
    { x: p.x + distance, y: p.y, z: p.z },
    headingQuat({ x: 0, y: 0, z: 0, w: 1 }, -90),
  );
}

describe('ロビー: レイドのモード', () => {
  it('レイドは全員が同じ側（味方の弾は当たらない）。開始は 2 人から', () => {
    expect(sameSide(0, 1, 'raid', () => undefined)).toBe(true);
    expect(sameSide(0, 1, 'ffa', () => undefined)).toBe(false);
    const players = [0, 1].map((id) => ({
      id,
      name: `P${id}`,
      aircraftId: 'kestrel',
      maxHp: 200,
      team: 0,
      ready: id === 1,
      again: false,
      away: false,
    }));
    expect(startBlock(players.slice(0, 1), 'raid')).toBe('players');
    expect(startBlock(players, 'raid')).toBeNull();
  });
});

describe('state の怪獣', () => {
  it('ホストの怪獣の状態を送って戻すと同じ値（量子化の誤差まで）、怪獣なしは 1 バイト', () => {
    const arena = new PvpArena(() => undefined);
    const raid = new RaidHost(arena, 3);
    for (let i = 0; i < 12 * 60; i++) raid.step(DT);
    raid.kaiju.part('tail').damageBy(5000, 0);
    const k = raid.state();
    const msg: StateMsg = {
      type: 'state',
      tick: 5,
      aircraft: [],
      missiles: [],
      kaiju: k,
      defense: null,
    };
    const back = decodeMessage(encodeMessage(msg));
    if (back?.type !== 'state' || !back.kaiju) throw new Error('decode');
    const b = back.kaiju;
    expect(b.stage).toBe(k.stage);
    expect(b.feet.x).toBeCloseTo(k.feet.x, 2);
    expect(b.heading).toBeCloseTo(k.heading, 3);
    expect(b.hp).toBe(Math.round(k.hp));
    expect(b.maxHp).toBe(k.maxHp);
    expect(b.parts[4]?.hpRatio).toBeCloseTo(k.parts[4]?.hpRatio ?? 0, 4);
    // 6-6: 歩数は 2 で割った余りを 1/128 で送る
    expect(Math.abs(b.walkPhase - (k.walkPhase % 2))).toBeLessThan(1 / 128 + 1e-9);
    const size = encodeMessage(msg).byteLength;
    const none = encodeMessage({ ...msg, kaiju: null }).byteLength;
    // 6-6: 怪獣の分は 40 バイト以下（有無の 1 バイトを含む）
    expect(size - none + 1).toBeLessThanOrEqual(40);
  });

  it('クライアントの写しは届いた位置へ寄り、部位の位置・HP を出す（ダメージは受けない）', () => {
    const arena = new PvpArena(() => undefined);
    const raid = new RaidHost(arena, 2);
    for (let i = 0; i < 15 * 60; i++) raid.step(DT);
    raid.kaiju.part('head').damageBy(1000, 0);
    const m = new KaijuMirror();
    m.receive(raid.state(), 1 / 15);
    for (let i = 0; i < 60; i++) m.step(DT);
    expect(m.visible).toBe(true);
    expect(m.feet.x).toBeCloseTo(raid.kaiju.feet.x, 1);
    expect(m.parts[0]?.position.y).toBeCloseTo(raid.kaiju.parts[0]?.position.y ?? 0, 0);
    expect(m.parts[0]?.hp).toBeCloseTo(raid.kaiju.parts[0]?.partHp ?? 0, -1);
    expect(m.parts[0]?.applyDamage()).toBe(false);
  });
});

describe('ホストの判定', () => {
  it('機銃は怪獣の部位に当たり、攻撃した人の ID でブレイクが成立する', () => {
    const { arena, kaiju, events } = raidArena(2);
    aimAt(arena, 0, kaiju, 1, 400);
    aimAt(arena, 1, kaiju, 1, 450);
    for (let i = 0; i < 60; i++) {
      arena.tick++;
      for (const id of [0, 1]) arena.stepFighter(id, controls({ fire: true }), DT, null);
      arena.endTick(DT);
    }
    expect(kaiju.hp).toBeLessThan(kaiju.maxHp);
    expect(events.some((e) => e.kind === 'hit' && e.b === KAIJU_ID_BASE + 1)).toBe(true);
    expect(kaiju.part('crystal').breakTimer).toBeGreaterThan(0);
    // 味方には当たらない
    expect(arena.fighters.get(1)?.hp).toBe(SPEC.maxHp);
  });

  it('ロックした部位へミサイルが飛び、部位 1 つにだけ範囲ダメージ', () => {
    const { arena, kaiju } = raidArena(1);
    aimAt(arena, 0, kaiju, 3, 900);
    arena.tick++;
    arena.stepFighter(
      0,
      controls({ missile: true, locked: true, targetId: KAIJU_ID_BASE + 3 }),
      DT,
      null,
    );
    arena.endTick(DT);
    for (let i = 0; i < 5 * 60; i++) {
      arena.tick++;
      arena.stepFighter(0, controls(), DT, null);
      arena.endTick(DT);
    }
    const damaged = kaiju.parts.filter((p) => p.partHp < p.partMaxHp);
    expect(damaged.map((p) => p.id)).toEqual(['rightLeg']);
  });

  it('怪獣の攻撃の当たりで撃墜（撃墜した人なし）、スタンは操作を止めて event を送る', () => {
    const { arena, events } = raidArena(2);
    arena.stun(1, 2);
    expect(events.at(-1)).toMatchObject({ kind: 'stun', a: 1, n: 200 });
    const f = arena.fighters.get(1);
    if (!f) throw new Error('no fighter');
    const q = { ...f.aircraft.state.orientation };
    for (let i = 0; i < 30; i++) {
      arena.tick++;
      arena.stepFighter(1, controls({ pitch: 1, roll: 1, fire: true }), DT, null);
      arena.endTick(DT);
    }
    expect(f.aircraft.state.orientation.x).toBeCloseTo(q.x, 3);
    expect(f.firing).toBe(false);
    arena.kaijuDamage(0, 10000);
    expect(events.at(-1)).toMatchObject({ kind: 'kill', a: 255, b: 0 });
  });
});

describe('協力の対戦', () => {
  it('ホストが怪獣を動かし、クライアントに state で届く。倒すと成功で全員が終わる', async () => {
    const settings: Partial<GameSettings> = { mode: 'raid' };
    const m = await startMatch(1, {}, settings);
    expect(m.host.raid).not.toBeNull();
    expect(m.host.raid?.kaiju.maxHp).toBe(Math.round(KAIJU_CONFIG.baseHp * 1.45));
    await m.run(10);
    const c = m.clients[0];
    expect(c?.kaiju?.stage).toBeGreaterThan(0);
    expect(c?.kaiju?.feet.x).toBeCloseTo(m.host.raid?.kaiju.feet.x ?? 0, -1);
    m.host.raid?.kaiju.part('tail').damageBy(1e7, 1);
    await m.run(0.5);
    expect(m.host.finished).toBe(true);
    const over = m.events[1]?.find((e) => e.kind === 'over');
    expect(over?.b).toBe(RAID_OUTCOME.clear);
  });
});

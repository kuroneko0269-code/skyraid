// 10-6: 協力のヴォルガス・ネフィルガの体への衝突（ホストが最大 HP の約 8 割を配る・跳ねない・続けて当たらない間）と、衝突のできごと ram
// （参加者の画面の火花・揺れ・音）。ほかの 3 体の差し込み口も同じできごとを送る
import { describe, expect, it } from 'vitest';
import type { ArenaEvent } from '../src/combat/arena-types';
import { PvpArena } from '../src/combat/pvp-arena';
import { RAID_CONFIG } from '../src/data/kaiju';
import { Aircraft } from '../src/entities/aircraft';
import { FlightSession } from '../src/missions/flight-session';
import { fighterSpec } from '../src/net/host-state';
import { Kaiju2Host } from '../src/net/kaiju2-host';
import { netLoadout } from '../src/net/loadout';
import { eventMsg } from '../src/net/protocol';
import { PvpMirror } from '../src/net/pvp-mirror';
import { RaidHost } from '../src/net/raid-host';

const SPEC = fighterSpec(netLoadout('kestrel', undefined));

function arenaWith(n: number, events: ArenaEvent[]): PvpArena {
  const arena = new PvpArena(
    (e) => {
      events.push({ ...e });
    },
    null,
    () => 0.5,
  );
  arena.setTeams(new Map(Array.from({ length: n }, (_, i) => [i, 0])));
  for (let i = 0; i < n; i++)
    arena.add(i, new Aircraft(netLoadout('kestrel', undefined).flight), SPEC);
  return arena;
}

/** 自機を from → to へ置く（前の位置と今の位置） */
function place(a: Aircraft, from: { x: number; y: number; z: number }, to: typeof from): void {
  Object.assign(a.prevPosition, from);
  Object.assign(a.state.position, to);
}

describe('10-6: 協力の体への衝突（ヴォルガス・ネフィルガ）', () => {
  it('ヴォルガス: ホストが胴にぶつかった人に最大 HP の約 8 割・ram のできごと・跳ねない・続けて当たらない', () => {
    const events: ArenaEvent[] = [];
    const arena = arenaWith(1, events);
    const h = new RaidHost(arena, 1);
    const f0 = arena.fighters.get(0);
    if (!f0) throw new Error('fighter');
    const far = { x: RAID_CONFIG.start.x, y: 3000, z: RAID_CONFIG.start.z };
    // 上陸し終わるまで（自機は遠く高く）
    for (let i = 0; i < 60 * 9; i++) {
      place(f0.aircraft, far, far);
      h.step(1 / 60);
    }
    expect(h.kaiju.targetable).toBe(true);
    expect(h.bodyHits).toBe(0);
    const hp = f0.hp;
    const k = h.kaiju.feet;
    const at = (dx: number): { x: number; y: number; z: number } => ({
      x: k.x + dx,
      y: k.y + 70,
      z: k.z,
    });
    place(f0.aircraft, at(-80), at(-10));
    h.step(1 / 60);
    expect(h.bodyHits).toBe(1);
    expect(hp - f0.hp).toBeCloseTo(f0.maxHp * 0.8, 0);
    expect(events.some((e) => e.kind === 'ram' && e.a === 0)).toBe(true);
    expect(Math.abs(f0.aircraft.state.position.x - (k.x - 10))).toBeLessThan(1);
    place(f0.aircraft, at(-10), at(0));
    h.step(1 / 60);
    expect(h.bodyHits).toBe(1);
  });

  it('ネフィルガ: ホストが胴にぶつかった人に最大 HP の約 8 割・ram のできごと', () => {
    const events: ArenaEvent[] = [];
    const arena = arenaWith(1, events);
    const h = new Kaiju2Host(arena, 1, {
      start: { x: 0, y: 500, z: 3000, headingDeg: 0 },
      seed: 7,
    });
    const f0 = arena.fighters.get(0);
    if (!f0) throw new Error('fighter');
    h.step(1 / 60);
    const hp = f0.hp;
    const b = h.raid.body.position;
    place(f0.aircraft, { x: b.x - 60, y: b.y, z: b.z }, { x: b.x, y: b.y, z: b.z });
    h.step(1 / 60);
    expect(h.bodyHits).toBe(1);
    expect(hp - f0.hp).toBeCloseTo(f0.maxHp * 0.8, 0);
    expect(events.filter((e) => e.kind === 'ram')).toHaveLength(1);
  });

  it('参加者の画面: 自分への ram のできごとで火花・揺れ・音の知らせ（ソロと同じ ramListeners）。ほかの人の分は出さない', () => {
    const session = new FlightSession({ flightOptions: { autoLevel: false } });
    const mirror = new PvpMirror(session, 1);
    const got: number[][] = [];
    session.combat.ramListeners.on((x, y, z) => got.push([x, y, z]));
    mirror.handleEvent(eventMsg('ram', 0, 0, 10, 0, 1, 2, 3));
    expect(got).toHaveLength(0);
    mirror.handleEvent(eventMsg('ram', 1, 0, 11, 0, 1, 2, 3));
    expect(got).toHaveLength(1);
    const p = session.aircraft.state.position;
    expect(got[0]).toEqual([p.x, p.y, p.z]);
  });
});

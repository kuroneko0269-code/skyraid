import { describe, expect, it } from 'vitest';
import { PvpArena, type PvpControls } from '../src/combat/pvp-arena';
import { PvpMatch, accuracy, standings } from '../src/combat/pvp-rules';
import { PVP_CONFIG, PVP_SPAWN_POINTS } from '../src/data/pvp';
import { Aircraft, createControls } from '../src/entities/aircraft';
import { netLoadout } from '../src/net/loadout';
import { NO_TARGET } from '../src/net/protocol';
import { seeded } from './net-helpers';

const DT = 1 / 60;
const KESTREL = netLoadout('kestrel', undefined);

/** 操作なし（水平飛行）。必要な欄だけ書き換えて使う */
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

function arenaWith(n: number): { arena: PvpArena; aircraft: Aircraft[] } {
  const arena = new PvpArena(() => undefined, null, seeded(1));
  const aircraft: Aircraft[] = [];
  for (let i = 0; i < n; i++) {
    const a = new Aircraft(KESTREL.flight);
    aircraft.push(a);
    arena.add(i, a, {
      maxHp: KESTREL.flight.hull.maxHp,
      hitRadius: KESTREL.flight.hull.hitRadius,
      visualRadius: KESTREL.flight.hull.visualRadius,
      gunDamage: KESTREL.gunDamage,
      missiles: KESTREL.missiles,
      flares: KESTREL.flares,
      targeting: KESTREL.targeting,
    });
  }
  return { arena, aircraft };
}

describe('PvP: ホストの判定（PvpArena）', () => {
  it('復帰位置は出現位置のうち他機から最も遠い所', () => {
    const { arena, aircraft } = arenaWith(3);
    const s0 = PVP_SPAWN_POINTS[0];
    const s1 = PVP_SPAWN_POINTS[1];
    if (!s0 || !s1) throw new Error('spawn');
    aircraft[1]?.respawn({ x: s0.x, y: s0.y, z: s0.z + 100 }, null);
    aircraft[2]?.respawn({ x: s1.x + 50, y: s1.y, z: s1.z }, null);
    const best = arena.farthestSpawn(0);
    const minDist = (i: number) => {
      const s = PVP_SPAWN_POINTS[i];
      if (!s) return 0;
      return Math.min(
        ...[1, 2].map((k) => {
          const p = aircraft[k]?.state.position ?? s;
          return Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
        }),
      );
    };
    for (let i = 0; i < PVP_SPAWN_POINTS.length; i++)
      expect(minDist(best)).toBeGreaterThanOrEqual(minDist(i));
    // 0 番・1 番の近くに 2 機がいるので、その反対側
    expect(best).toBeGreaterThanOrEqual(4);
    expect(best).toBeLessThanOrEqual(5);
  });

  it('撃墜されると 3 秒後に復帰し、その後 3 秒の無敵の間はダメージ 0、過ぎたら当たる', () => {
    const events: string[] = [];
    const arena = new PvpArena((e) => events.push(e.kind), null, seeded(1));
    const shooterA = new Aircraft(KESTREL.flight);
    const targetA = new Aircraft(KESTREL.flight);
    const spec = {
      maxHp: KESTREL.flight.hull.maxHp,
      hitRadius: KESTREL.flight.hull.hitRadius,
      visualRadius: KESTREL.flight.hull.visualRadius,
      gunDamage: KESTREL.gunDamage,
      missiles: KESTREL.missiles,
      flares: KESTREL.flares,
      targeting: KESTREL.targeting,
    };
    const shooter = arena.add(0, shooterA, spec);
    const target = arena.add(1, targetA, spec);
    const tick = (fire: boolean) => {
      arena.tick++;
      arena.stepFighter(0, controls({ fire }), DT, null);
      arena.stepFighter(1, controls(), DT, null);
      arena.endTick(DT);
    };
    /** 撃つ側を対象の 200m 後ろ・同じ向きに置き直す */
    const lineUp = () => {
      const p = targetA.state.position;
      shooterA.respawn({ x: p.x, y: p.y, z: p.z + 200 }, targetA.state.orientation);
      shooterA.state.speed = targetA.state.speed;
    };
    lineUp();
    for (let k = 0; k < 600 && target.alive; k++) tick(true);
    expect(target.alive).toBe(false);
    expect(shooter.kills).toBe(1);
    expect(target.deaths).toBe(1);
    // 3 秒後に復帰
    let ticks = 0;
    while (!target.alive && ticks < 600) {
      tick(false);
      ticks++;
    }
    expect(ticks / 60).toBeCloseTo(PVP_CONFIG.respawnSeconds, 1);
    expect(events).toContain('respawn');
    expect(target.invulnerable).toBe(true);
    // 無敵の間（3 秒）に撃っても HP は減らない（命中はする）
    lineUp();
    const hitsBefore = shooter.hits;
    for (let k = 0; k < 150; k++) tick(true);
    expect(shooter.hits).toBeGreaterThan(hitsBefore);
    expect(target.hp).toBe(target.maxHp);
    // 無敵が切れたら当たる
    while (target.invulnerable) tick(false);
    lineUp();
    for (let k = 0; k < 60; k++) tick(true);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('ミサイル: ロックを信頼せず円錐を見直す（後ろの相手へのロックは無誘導になる）', () => {
    const { arena, aircraft } = arenaWith(2);
    aircraft[0]?.respawn({ x: 0, y: 1000, z: 0 }, null);
    aircraft[1]?.respawn({ x: 0, y: 1000, z: 1500 }, null);
    arena.tick++;
    arena.stepFighter(0, controls({ missile: true, locked: true, targetId: 1 }), DT, null);
    arena.endTick(DT);
    expect(arena.missiles.missiles.count).toBe(1);
    expect(arena.missiles.missiles.get(0).target).toBeNull();
    // 正面の相手なら誘導
    const b = arenaWith(2);
    b.aircraft[0]?.respawn({ x: 0, y: 1000, z: 0 }, null);
    b.aircraft[1]?.respawn({ x: 0, y: 1000, z: -1500 }, null);
    b.arena.tick++;
    b.arena.stepFighter(0, controls({ missile: true, locked: true, targetId: 1 }), DT, null);
    expect(b.arena.missiles.missiles.get(0).target).toBe(b.arena.fighters.get(1));
  });
});

describe('PvP: ルール', () => {
  it('撃墜数の上限に達したら score、制限時間で time', () => {
    const m = new PvpMatch({ timeLimitSeconds: 300, scoreLimit: 10 });
    const scores = [
      { id: 0, kills: 9, deaths: 0, shots: 0, hits: 0 },
      { id: 1, kills: 0, deaths: 9, shots: 0, hits: 0 },
    ];
    expect(m.step(1, scores)).toBeNull();
    scores[0] = { ...scores[0], id: 0, kills: 10, deaths: 0, shots: 0, hits: 0 };
    expect(m.step(1, scores)).toBe('score');
    expect(m.step(1, scores)).toBeNull();
    const t = new PvpMatch({ timeLimitSeconds: 5, scoreLimit: 10 });
    let end = null;
    for (let k = 0; k < 6 * 60 && !end; k++) end = t.step(DT, []);
    expect(end).toBe('time');
    expect(t.elapsed).toBeCloseTo(5, 1);
    expect(t.remainingSeconds).toBe(0);
  });

  it('順位は撃墜数 → 被撃墜数の少なさ。同じなら同順位。命中率は機銃の命中 / 発射', () => {
    const list = standings([
      { id: 0, kills: 3, deaths: 2, shots: 100, hits: 10 },
      { id: 1, kills: 5, deaths: 4, shots: 0, hits: 0 },
      { id: 2, kills: 3, deaths: 1, shots: 10, hits: 5 },
      { id: 3, kills: 3, deaths: 2, shots: 1, hits: 1 },
    ]);
    expect(list.map((s) => [s.score.id, s.rank])).toEqual([
      [1, 1],
      [2, 2],
      [0, 3],
      [3, 3],
    ]);
    expect(accuracy({ id: 0, kills: 0, deaths: 0, shots: 100, hits: 10 })).toBeCloseTo(0.1);
    expect(accuracy({ id: 0, kills: 0, deaths: 0, shots: 0, hits: 0 })).toBe(0);
  });
});

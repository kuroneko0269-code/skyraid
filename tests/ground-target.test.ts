// 地上目標（2-6）: 種類ごとの HP・地形への接地・燃料タンクの誘爆（対空砲は aaa.test.ts）
import { describe, expect, it } from 'vitest';
import { TEAM_PLAYER } from '../src/combat/target';
import {
  FUEL_TANK_BLAST,
  GROUND_TARGET_SPECS,
  GROUND_TARGET_TYPES,
} from '../src/data/ground-targets';
import { GroundTarget } from '../src/entities/ground-target';
import { FlightSession } from '../src/missions/flight-session';
import { getGroundHeight } from '../src/render/terrain-height';

const DT = 1 / 60;

describe('地上目標の種類と接地', () => {
  it('HP はレーダー 300・燃料タンク 200・格納庫 600・対空砲 250', () => {
    const hp = GROUND_TARGET_TYPES.map((t) => {
      const g = new GroundTarget();
      g.deploy('g', t, 0, 0);
      return [t, g.hp, g.maxHp];
    });
    expect(hp).toEqual([
      ['radar', 300, 300],
      ['fuelTank', 200, 200],
      ['hangar', 600, 600],
      ['aaa', 250, 250],
    ]);
  });

  it('足元の四隅と中心のうち最も低い地表に立てる（斜面で浮かない）。当たり判定はその上 centerHeight', () => {
    // x 方向に 1m で 0.5m 上がる斜面
    const slope = (x: number): number => 100 + x * 0.5;
    const g = new GroundTarget(slope);
    g.deploy('g', 'hangar', 0, 0);
    const r = GROUND_TARGET_SPECS.hangar.footprint;
    expect(g.base.y).toBeCloseTo(100 - r * 0.5, 9);
    expect(g.position.y).toBeCloseTo(g.base.y + GROUND_TARGET_SPECS.hangar.centerHeight, 9);
    // 海の上（地形が負）なら海面に立てる
    const sea = new GroundTarget(() => -40);
    sea.deploy('g', 'radar', 0, 0);
    expect(sea.base.y).toBe(0);
  });

  it('本番の地形でも、足元の地表のどこより高い所には立てない', () => {
    for (const t of GROUND_TARGET_TYPES) {
      const g = new GroundTarget(getGroundHeight);
      g.deploy('g', t, -1300, 1000);
      const r = GROUND_TARGET_SPECS[t].footprint;
      for (const [dx, dz] of [
        [0, 0],
        [-r, -r],
        [r, r],
        [r, -r],
        [-r, r],
      ] as const) {
        expect(g.base.y).toBeLessThanOrEqual(getGroundHeight(-1300 + dx, 1000 + dz) + 1e-9);
      }
    }
  });

  it('壊れると active でなくなり、残骸（wrecked）として黒煙の時間を数える。燃料タンクだけ誘爆する', () => {
    const g = new GroundTarget();
    g.deploy('g', 'radar', 0, 0);
    expect(g.deathBlast).toBeNull();
    expect(g.applyDamage(299)).toBe(false);
    expect(g.applyDamage(1)).toBe(true);
    expect(g.active).toBe(false);
    expect(g.wrecked).toBe(true);
    for (let i = 0; i < 60; i++) g.step(DT);
    expect(g.wreckSeconds).toBeCloseTo(1, 6);
    g.deploy('g', 'fuelTank', 0, 0);
    expect(g.deathBlast).toBe(FUEL_TANK_BLAST);
  });
});

describe('燃料タンクの範囲ダメージ', () => {
  function session(): FlightSession {
    const s = new FlightSession({ rng: () => 0.5 });
    s.startMission({ x: 0, y: 30, z: 0, headingDeg: 0 });
    return s;
  }

  it('壊れると周囲 60m（表面まで）に中心 120・縁 36。60m より外には入らない。自機にも入る', () => {
    const s = session();
    s.spawn({
      kind: 'groundTarget',
      group: 'g',
      targetType: 'fuelTank',
      trigger: { type: 'start' },
      positions: [
        { x: 0, z: -40 },
        { x: 0, z: -200 },
      ],
    });
    s.spawn({
      kind: 'groundTarget',
      group: 'g',
      targetType: 'hangar',
      trigger: { type: 'start' },
      positions: [{ x: 50, z: -40 }],
    });
    const [tank, far, hangar] = s.props.groundTargets;
    if (!tank || !far || !hangar) throw new Error('地上目標がない');
    const before = s.player.hp;
    s.combat.dealDamage(tank, 1000, TEAM_PLAYER);
    expect(tank.active).toBe(false);
    // 格納庫: 中心どうし約 50m、表面まで約 26m
    const t = tank.position;
    const h = hangar.position;
    const dHangar = Math.hypot(h.x - t.x, h.y - t.y, h.z - t.z) - hangar.hitRadius;
    const expectedHangar = 120 * (1 - 0.7 * (dHangar / 60));
    expect(hangar.maxHp - hangar.hp).toBeCloseTo(expectedHangar, 6);
    // 遠い燃料タンク（160m）は無傷
    expect(far.hp).toBe(far.maxHp);
    // 自機（タンクの中心から約 41m）にも入る
    const p = s.player.position;
    const dPlayer =
      Math.hypot(p.x - tank.position.x, p.y - tank.position.y, p.z - tank.position.z) -
      s.player.hitRadius;
    expect(dPlayer).toBeLessThan(60);
    expect(before - s.player.hp).toBeCloseTo(120 * (1 - 0.7 * (Math.max(0, dPlayer) / 60)), 6);
    // 破壊の数え上げは誘爆した分も含む（ここではタンク 1 つだけ壊れた）
    expect(s.destroyedCount('groundTarget', 'g')).toBe(1);
  });

  it('隣の燃料タンクが範囲内なら誘爆が連鎖する（同じ目標を 2 回壊さない）', () => {
    const s = session();
    s.spawn({
      kind: 'groundTarget',
      group: 'g',
      targetType: 'fuelTank',
      trigger: { type: 'start' },
      positions: [
        { x: 1000, z: -1000 },
        { x: 1015, z: -1000 },
        { x: 1030, z: -1000 },
      ],
    });
    const [a, b, c] = s.props.groundTargets;
    if (!a || !b || !c) throw new Error('地上目標がない');
    // a → b は表面まで 1m（約 119）、a → c は 16m（約 98）。HP 200 なので 1 回では壊れない
    s.combat.dealDamage(a, 1000, TEAM_PLAYER);
    expect(b.active).toBe(true);
    expect(c.active).toBe(true);
    s.combat.dealDamage(b, 100, TEAM_PLAYER);
    expect(b.active).toBe(false);
    // b の誘爆で c にも 2 回目が入って壊れる
    expect(c.active).toBe(false);
    expect(s.destroyedCount('groundTarget', 'g')).toBe(3);
    expect(s.combat.kills).toBe(3);
  });
});

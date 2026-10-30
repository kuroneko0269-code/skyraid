import { describe, expect, it } from 'vitest';
import { CombatSystem } from '../src/combat/combat-system';
import { Gun, type GunTarget, type Shooter } from '../src/combat/gun';
import { GUN_CONFIG, type GunSpec } from '../src/data/weapons';
import { TARGET_CONFIG } from '../src/data/targets';
import { TargetField } from '../src/entities/target-balloon';

const DT = 1 / 60;
const NO_SPREAD: GunSpec = { ...GUN_CONFIG, spreadDeg: 0 };
const FIRE = {
  trigger: true,
  missile: false,
  flare: false,
  targetNext: false,
  rocket: false,
  bomb: false,
  bombHeld: false,
};

/** 原点で -Z（前方）を向いて静止した機体 */
function shooter(speed = 0, y = 0): Shooter {
  return { position: { x: 0, y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, speed };
}

function target(x: number, y: number, z: number, hitRadius: number): GunTarget {
  return { position: { x, y, z }, hitRadius, active: true };
}

describe('機銃の連射と弾', () => {
  it('引き金を引いている間 fireRate 発/秒で撃つ', () => {
    const gun = new Gun(NO_SPREAD);
    for (let i = 0; i < 60; i++) gun.step(true, shooter(), [], DT);
    const first = gun.shotCount;
    for (let i = 0; i < 60; i++) gun.step(true, shooter(), [], DT);
    expect(gun.shotCount - first).toBe(NO_SPREAD.fireRate);
  });

  it('押した瞬間に 1 発目が出る', () => {
    const gun = new Gun(NO_SPREAD);
    gun.step(false, shooter(), [], DT);
    gun.step(true, shooter(), [], DT);
    expect(gun.shotCount).toBe(1);
  });

  it('弾は重力で落ちる（落下量 ≈ g t² / 2）', () => {
    const gun = new Gun(NO_SPREAD);
    gun.step(true, shooter(), [], DT);
    const b = gun.bullets.get(0);
    const startY = b.y;
    const steps = 60;
    for (let i = 0; i < steps; i++) gun.step(false, shooter(), [], DT);
    const t = (steps + 1) * DT;
    const drop = startY - b.y;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeCloseTo((NO_SPREAD.gravity * t * t) / 2, 0);
  });

  it('射程を飛ぶと消え、プールに戻る', () => {
    const gun = new Gun(NO_SPREAD);
    gun.step(true, shooter(), [], DT);
    expect(gun.bullets.count).toBe(1);
    const seconds = NO_SPREAD.range / NO_SPREAD.muzzleSpeed + 0.1;
    for (let i = 0; i < seconds / DT; i++) gun.step(false, shooter(), [], DT);
    expect(gun.bullets.count).toBe(0);
  });

  it('機体の速度が弾速に足される', () => {
    const gun = new Gun(NO_SPREAD);
    gun.step(true, shooter(250), [], DT);
    expect(-gun.bullets.get(0).vz).toBeCloseTo(250 + NO_SPREAD.muzzleSpeed, 0);
  });

  it('撃ち続けるとオーバーヒートして止まり、冷えるとまた撃てる', () => {
    const gun = new Gun(NO_SPREAD);
    let t = 0;
    while (!gun.heat.overheated && t < 20) {
      gun.step(true, shooter(), [], DT);
      t += DT;
    }
    expect(gun.heat.overheated).toBe(true);
    // 約 4 秒（60 発 ÷ 15 発/秒）
    expect(t).toBeGreaterThan(3.5);
    expect(t).toBeLessThan(4.5);
    const shots = gun.shotCount;
    for (let i = 0; i < 30; i++) gun.step(true, shooter(), [], DT);
    expect(gun.shotCount).toBe(shots);
    for (let i = 0; i < 120; i++) gun.step(true, shooter(), [], DT);
    expect(gun.shotCount).toBeGreaterThan(shots);
  });

  it('弾数は無限（プールの弾が再利用される）', () => {
    const gun = new Gun({ ...NO_SPREAD, heat: { ...NO_SPREAD.heat, perShot: 0 } });
    for (let i = 0; i < 60 * 30; i++) gun.step(true, shooter(), [], DT);
    // 0 秒目と 30 秒目の両端を含む
    expect(gun.shotCount).toBe(NO_SPREAD.fireRate * 30 + 1);
    expect(gun.bullets.count).toBeLessThan(NO_SPREAD.maxBullets);
  });
});

describe('機銃の当たり判定', () => {
  it('1 ステップで半径より長く進んでも、線分で当たる（すり抜けない）', () => {
    const hits: (GunTarget | null)[] = [];
    const gun = new Gun<GunTarget>(NO_SPREAD, (h) => hits.push(h.target));
    // 弾は 1 ステップで約 20m 進む。半径 1m の小さな球を 300m 先に置く（銃口の高さに合わせる）
    const t = target(0, NO_SPREAD.muzzleOffset.y, -300, 1);
    gun.step(true, shooter(), [t], DT);
    for (let i = 0; i < 30; i++) gun.step(false, shooter(), [t], DT);
    expect(hits).toEqual([t]);
    expect(gun.bullets.count).toBe(0);
  });

  it('外れた弾は当たらない', () => {
    const hits: unknown[] = [];
    const gun = new Gun<GunTarget>(NO_SPREAD, (h) => hits.push(h.target));
    const t = target(30, 0, -300, 5);
    gun.step(true, shooter(), [t], DT);
    for (let i = 0; i < 30; i++) gun.step(false, shooter(), [t], DT);
    expect(hits).toHaveLength(0);
  });

  it('手前の対象に当たる', () => {
    const hits: (GunTarget | null)[] = [];
    const gun = new Gun<GunTarget>(NO_SPREAD, (h) => hits.push(h.target));
    const y = NO_SPREAD.muzzleOffset.y;
    const far = target(0, y, -330, 5);
    const near = target(0, y, -310, 5);
    gun.step(true, shooter(), [far, near], DT);
    for (let i = 0; i < 30; i++) gun.step(false, shooter(), [far, near], DT);
    expect(hits).toEqual([near]);
  });

  it('非アクティブな対象は無視する', () => {
    const hits: unknown[] = [];
    const gun = new Gun<GunTarget>(NO_SPREAD, (h) => hits.push(h.target));
    const t = { ...target(0, 0, -300, 5), active: false };
    gun.step(true, shooter(), [t], DT);
    for (let i = 0; i < 30; i++) gun.step(false, shooter(), [t], DT);
    expect(hits).toHaveLength(0);
  });

  it('地面に当たると消える（target は null）', () => {
    const hits: (GunTarget | null)[] = [];
    const gun = new Gun<GunTarget>(
      NO_SPREAD,
      (h) => hits.push(h.target),
      () => 0,
    );
    // 高度 2m から水平に撃つと、重力で落ちて海面に当たる
    gun.step(true, shooter(0, 2), [], DT);
    for (let i = 0; i < 90; i++) gun.step(false, shooter(0, 2), [], DT);
    expect(hits).toEqual([null]);
  });
});

describe('的と撃墜', () => {
  it('的を撃ち続けると撃墜され、撃墜数とヒットマーカーが更新される', () => {
    const field = new TargetField(
      () => 0,
      () => 0.5,
    );
    const combat = new CombatSystem(field, null, () => 0.5, NO_SPREAD);
    const b = field.balloons[0];
    if (!b) throw new Error('的がない');
    let destroyed = 0;
    combat.onDestroyed(() => destroyed++);
    // 的の 300m 南、同じ高さから -Z（的の方向）へ撃つ
    const s: Shooter = {
      position: {
        x: b.position.x,
        y: b.position.y - NO_SPREAD.muzzleOffset.y,
        z: b.position.z + 300,
      },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      speed: 0,
    };
    let sawMarker = false;
    for (let i = 0; i < 60 * 3 && combat.kills === 0; i++) {
      combat.step(FIRE, s, DT);
      if (combat.hitMarkerTimer > 0) sawMarker = true;
    }
    expect(sawMarker).toBe(true);
    expect(combat.kills).toBe(1);
    expect(destroyed).toBe(1);
    expect(b.isDestroyed).toBe(true);
    expect(b.active).toBe(false);
  });

  it('撃墜された的は respawnSeconds 後に別の空いた地点へ再出現する', () => {
    const field = new TargetField(
      () => 10,
      () => 0.99,
    );
    const b = field.balloons[0];
    if (!b) throw new Error('的がない');
    const oldIndex = b.spawnIndex;
    b.applyDamage(b.maxHp);
    expect(b.isDestroyed).toBe(true);
    for (let t = 0; t < TARGET_CONFIG.respawnSeconds - 0.1; t += DT) field.step(DT);
    expect(b.isDestroyed).toBe(true);
    for (let i = 0; i < 12; i++) field.step(DT);
    expect(b.isDestroyed).toBe(false);
    expect(b.hp).toBe(b.maxHp);
    expect(b.spawnIndex).not.toBe(oldIndex);
    const used = field.balloons.map((x) => x.spawnIndex);
    expect(new Set(used).size).toBe(used.length);
    const p = TARGET_CONFIG.spawnPoints[b.spawnIndex];
    expect(b.position.x).toBe(p?.x);
  });

  it('的はゆっくり上下する（振幅以内）', () => {
    const field = new TargetField(() => 0);
    const b = field.balloons[0];
    if (!b) throw new Error('的がない');
    const base = TARGET_CONFIG.spawnPoints[0]?.agl ?? 0;
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < TARGET_CONFIG.bob.period; t += DT) {
      field.step(DT);
      min = Math.min(min, b.position.y);
      max = Math.max(max, b.position.y);
    }
    expect(max - min).toBeGreaterThan(TARGET_CONFIG.bob.amplitude);
    expect(max).toBeLessThanOrEqual(base + TARGET_CONFIG.bob.amplitude + 1e-9);
    expect(min).toBeGreaterThanOrEqual(base - TARGET_CONFIG.bob.amplitude - 1e-9);
  });

  it('reset で撃墜数・弾・的が戻る', () => {
    const field = new TargetField();
    const combat = new CombatSystem(field);
    combat.kills = 3;
    field.balloons[0]?.applyDamage(1000);
    combat.step(FIRE, shooter(), DT);
    combat.reset();
    expect(combat.kills).toBe(0);
    expect(combat.gun.bullets.count).toBe(0);
    expect(field.balloons.every((x) => !x.isDestroyed)).toBe(true);
  });
});

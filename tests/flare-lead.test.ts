import { describe, expect, it } from 'vitest';
import { CombatSystem, type CombatInput } from '../src/combat/combat-system';
import { FlareField, findDecoy } from '../src/combat/flare';
import { Gun, type Shooter } from '../src/combat/gun';
import { leadPoint } from '../src/combat/lead';
import { MissileSystem } from '../src/combat/missile';
import { DRONE_CONFIG } from '../src/data/targets';
import { FLARE_CONFIG, GUN_CONFIG, MISSILE_CONFIG, type GunSpec } from '../src/data/weapons';
import { TargetField } from '../src/entities/target-balloon';
import { TargetDrone } from '../src/entities/target-drone';
import { DEG, DT, IDENTITY, lookQuat, point, shooter } from './combat-helpers';

describe('フレアへの乗り換え', () => {
  /** 原点で -Z を向き、600 m/s で飛ぶ敵（陣営 1）のミサイル。目標は 2km 先 */
  function setup(rngValue: number) {
    const flares = new FlareField();
    const target = point(0, 0, -2000);
    const sys = new MissileSystem<typeof target>(MISSILE_CONFIG, undefined, null, () => rngValue);
    const m = sys.launch(shooter(600), target, 1);
    if (!m) throw new Error('発射できない');
    // 誘導が始まるまで進める
    for (let i = 0; i < Math.round(MISSILE_CONFIG.straightSeconds / DT) + 1; i++)
      sys.step([], flares.flares, DT);
    // 目標（陣営 0）がミサイルの前方 1km でフレアを撒く（後ろ = ミサイルの方へ）
    const at: Shooter = {
      position: { x: 0, y: 0, z: m.position.z - 1000 },
      orientation: IDENTITY,
      speed: 200,
    };
    return { flares, target, sys, m, at };
  }

  it('視野内のフレアを見ると、確率（decoyChance）未満の乱数なら目標をフレアに乗り換える', () => {
    const { flares, sys, m, at } = setup(FLARE_CONFIG.decoyChance - 0.01);
    expect(flares.tryRelease(at, 0)).toBe(true);
    sys.step([], flares.flares, DT);
    expect(m.target).not.toBeNull();
    expect(flares.flares.count).toBe(FLARE_CONFIG.perBurst);
    const isFlare = [0, 1, 2, 3].some((i) => flares.flares.get(i) === m.target);
    expect(isFlare).toBe(true);
  });

  it('乱数が確率以上なら乗り換えず、同じ放出では 2 度判定しない', () => {
    const { flares, target, sys, m, at } = setup(FLARE_CONFIG.decoyChance + 0.01);
    flares.tryRelease(at, 0);
    for (let i = 0; i < 30; i++) sys.step([], flares.flares, DT);
    expect(m.target).toBe(target);
    expect(m.checkedBurst).toBe(1);
  });

  it('自分の陣営のフレア・視野の外のフレアには釣られない', () => {
    const { flares, target, sys, m, at } = setup(0);
    flares.tryRelease(at, 1);
    sys.step([], flares.flares, DT);
    expect(m.target).toBe(target);
    // 真横 1km（視野 50° の外）
    flares.release({ ...at, position: { x: 1000, y: 0, z: m.position.z } }, 0);
    sys.step([], flares.flares, DT);
    expect(m.target).toBe(target);
    expect(
      findDecoy(m.position, { x: 0, y: 0, z: -1 }, 1, 0, flares.flares, Math.cos(50 * DEG), 2000),
    ).toBeNull();
  });

  it('フレアは後方へ流れて lifeSeconds で消え、追っていたミサイルは目標を失う', () => {
    const { flares, sys, m, at } = setup(0);
    flares.tryRelease(at, 0);
    sys.step([], flares.flares, DT);
    expect(flares.flares.get(0).velocity.z).toBeLessThan(0);
    for (let i = 0; i < Math.round(FLARE_CONFIG.lifeSeconds / DT) + 1; i++) {
      flares.step(DT);
    }
    expect(flares.flares.count).toBe(0);
    sys.step([], flares.flares, DT);
    expect(m.target).toBeNull();
  });
});

describe('予測照準点', () => {
  const NO_SPREAD: GunSpec = { ...GUN_CONFIG, spreadDeg: 0 };

  it('静止した対象なら対象の位置（+ 落下分の持ち上げ）', () => {
    const out = { x: 0, y: 0, z: 0 };
    const t = leadPoint(
      out,
      { x: 0, y: 0, z: 0 },
      1000,
      { x: 0, y: 0, z: -1000 },
      { x: 0, y: 0, z: 0 },
      9.8,
      2,
    );
    expect(t).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(-1000);
    expect(out.y).toBeCloseTo(4.9);
  });

  it('横に動く対象: 照準点まで弾が飛ぶ時間 = 対象がそこへ来る時間', () => {
    const out = { x: 0, y: 0, z: 0 };
    const v = { x: 120, y: 0, z: 0 };
    const t = leadPoint(out, { x: 0, y: 0, z: 0 }, 1150, { x: 0, y: 0, z: -800 }, v, 0, 2);
    expect(t).toBeGreaterThan(0);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1150 * t, 6);
    expect(out.x).toBeCloseTo(120 * t, 6);
  });

  it('届かない（射程外・弾より速く遠ざかる）なら -1', () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(
      leadPoint(
        out,
        { x: 0, y: 0, z: 0 },
        1000,
        { x: 0, y: 0, z: -3000 },
        { x: 0, y: 0, z: 0 },
        0,
        1.3,
      ),
    ).toBe(-1);
    expect(
      leadPoint(
        out,
        { x: 0, y: 0, z: 0 },
        100,
        { x: 0, y: 0, z: -300 },
        { x: 0, y: 0, z: -200 },
        0,
        10,
      ),
    ).toBe(-1);
  });

  it('予測照準点に機首を向けて撃つと、動いている的に当たる', () => {
    const target = {
      position: { x: -60, y: 0, z: -900 },
      velocity: { x: 120, y: 15, z: 40 },
      hitRadius: 3,
      active: true,
    };
    const speed = 250;
    const muzzle = GUN_CONFIG.muzzleOffset;
    const aim = { x: 0, y: 0, z: 0 };
    const t = leadPoint(
      aim,
      { x: 0, y: muzzle.y, z: muzzle.z },
      speed + NO_SPREAD.muzzleSpeed,
      target.position,
      target.velocity,
      NO_SPREAD.gravity,
      2,
    );
    expect(t).toBeGreaterThan(0);
    // 機首方向に照準点（銃口のずれは小さいので機体の中心から向ける）
    const s = shooter(speed, lookQuat(aim));
    let hit = 0;
    const gun = new Gun<typeof target>(NO_SPREAD, (h) => h.target && hit++);
    gun.step(true, s, [target], DT);
    for (let i = 0; i < 120 && hit === 0; i++) {
      target.position.x += target.velocity.x * DT;
      target.position.y += target.velocity.y * DT;
      target.position.z += target.velocity.z * DT;
      gun.step(false, s, [target], DT);
    }
    expect(hit).toBe(1);
  });

  it('CombatSystem は選択中の対象の予測照準点を、機銃の射程内のときだけ出す', () => {
    const combat = new CombatSystem(
      new TargetField(
        () => -10000,
        () => 0.5,
      ),
      null,
      () => 0.5,
      NO_SPREAD,
      0.1,
      [],
    );
    const b = combat.targets.balloons[0];
    if (!b) throw new Error('的がない');
    const idle: CombatInput = { trigger: false, missile: false, flare: false, targetNext: false };
    const near = { x: b.position.x, y: b.position.y, z: b.position.z + 800 };
    combat.step(idle, { position: near, orientation: IDENTITY, speed: 250 }, DT);
    expect(combat.targeting.selected).toBe(b);
    expect(combat.leadValid).toBe(true);
    const far = { x: b.position.x, y: b.position.y, z: b.position.z + 3000 };
    combat.step(idle, { position: far, orientation: IDENTITY, speed: 250 }, DT);
    expect(combat.leadValid).toBe(false);
  });
});

describe('周回ドローン', () => {
  it('一定高度・一定速度で円を描き、撃墜から respawnSeconds 後に再出現', () => {
    const d = new TargetDrone({ centerX: 0, centerZ: 0, radius: 2000, altitude: 800, phase: 0 });
    for (let i = 0; i < 600; i++) {
      d.step(DT);
      expect(Math.hypot(d.position.x, d.position.z)).toBeCloseTo(2000, 6);
      expect(d.position.y).toBe(800);
    }
    expect(Math.hypot(d.velocity.x, d.velocity.z)).toBeCloseTo(DRONE_CONFIG.speed);
    // 1 ステップの移動量 = 速さ × dt
    const moved = Math.hypot(d.position.x - d.prevPosition.x, d.position.z - d.prevPosition.z);
    expect(moved).toBeCloseTo(DRONE_CONFIG.speed * DT, 3);
    expect(d.applyDamage(1000)).toBe(true);
    expect(d.active).toBe(false);
    for (let i = 0; i < Math.round(DRONE_CONFIG.respawnSeconds / DT) - 1; i++) d.step(DT);
    expect(d.active).toBe(false);
    d.step(DT);
    d.step(DT);
    expect(d.active).toBe(true);
    expect(d.hp).toBe(DRONE_CONFIG.maxHp);
  });
});

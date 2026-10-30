import { describe, expect, it } from 'vitest';
import { CombatSystem, type CombatInput } from '../src/combat/combat-system';
import type { Shooter } from '../src/combat/gun';
import { proportionalNavigation } from '../src/combat/guidance';
import { Magazine } from '../src/combat/magazine';
import {
  MissileSystem,
  splashDamage,
  type FuseTarget,
  type HomingTarget,
} from '../src/combat/missile';
import { DRONE_CONFIG, TARGET_CONFIG } from '../src/data/targets';
import { FLARE_CONFIG, GUN_CONFIG, MISSILE_CONFIG } from '../src/data/weapons';
import { TargetField } from '../src/entities/target-balloon';
import { TargetDrone } from '../src/entities/target-drone';
import { DEG, DT, IDENTITY, angleBetween, lookQuat, point, shooter } from './combat-helpers';

describe('弾数とクールダウン', () => {
  it('間隔をあけないと撃てず、弾が尽きたら撃てない。補給で満タン', () => {
    const m = new Magazine(4, 0.4);
    expect(m.tryUse()).toBe(true);
    expect(m.tryUse()).toBe(false);
    for (let i = 0; i < Math.round(0.4 / DT); i++) m.step(DT);
    expect(m.tryUse()).toBe(true);
    let shots = 2;
    for (let i = 0; i < 600; i++) {
      m.step(DT);
      if (m.tryUse()) shots++;
    }
    expect(shots).toBe(4);
    expect(m.count).toBe(0);
    m.refill();
    expect(m.count).toBe(4);
    expect(m.ready).toBe(true);
  });

  it('初期機はミサイル 4 発、フレアは 6 回・2 秒のクールダウン', () => {
    const combat = new CombatSystem(
      new TargetField(
        () => 0,
        () => 0.5,
      ),
      null,
      () => 0.5,
    );
    const press: CombatInput = {
      trigger: false,
      missile: true,
      flare: true,
      targetNext: false,
      rocket: false,
      bomb: false,
      bombHeld: false,
    };
    const idle: CombatInput = {
      trigger: false,
      missile: false,
      flare: false,
      targetNext: false,
      rocket: false,
      bomb: false,
      bombHeld: false,
    };
    const s = shooter(250, IDENTITY, 3000);
    let flares = 0;
    for (let i = 0; i < 60 * 20; i++) {
      const before = combat.flares.magazine.count;
      combat.step(i % 10 === 0 ? press : idle, s, DT);
      if (combat.flares.magazine.count < before) flares++;
      // クールダウン中は押しても撒けない
      if (i === 30) expect(combat.flares.magazine.count).toBe(FLARE_CONFIG.charges - 1);
    }
    expect(MISSILE_CONFIG.ammo).toBe(4);
    expect(combat.missileAmmo.count).toBe(0);
    expect(flares).toBe(FLARE_CONFIG.charges);
    combat.reset();
    expect(combat.missileAmmo.count).toBe(4);
    expect(combat.flares.magazine.count).toBe(6);
  });
});

describe('比例航法', () => {
  it('旋回は最大旋回率を超えない（大きな視線角速度でも頭打ち）', () => {
    const maxTurn = MISSILE_CONFIG.maxTurnDeg * DEG;
    const dir = { x: 0, y: 0, z: -1 };
    const out = { x: 0, y: 0, z: 0 };
    const target: HomingTarget = {
      position: { x: 50, y: 30, z: -100 },
      velocity: { x: 300, y: -200, z: 0 },
      active: true,
    };
    proportionalNavigation(
      out,
      dir,
      { x: 0, y: 0, z: -600 },
      { x: 0, y: 0, z: 0 },
      target,
      4,
      maxTurn,
      DT,
    );
    const turned = angleBetween(dir, out);
    expect(turned).toBeGreaterThan(maxTurn * DT * 0.9);
    expect(turned).toBeLessThanOrEqual(maxTurn * DT + 1e-9);
  });

  it('視線が回っていなければ（衝突コース）向きを変えない', () => {
    const out = { x: 0, y: 0, z: 0 };
    // 目標は同じ速度で真正面を遠ざかる → 視線角速度 0
    const target: HomingTarget = {
      position: { x: 0, y: 0, z: -1000 },
      velocity: { x: 0, y: 0, z: -600 },
      active: true,
    };
    proportionalNavigation(
      out,
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -600 },
      { x: 0, y: 0, z: 0 },
      target,
      4,
      1,
      DT,
    );
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(-1, 9);
  });

  it('飛行中のどのステップでも旋回角は maxTurnDeg × dt 以下', () => {
    const t = point(800, 300, -1500);
    t.velocity.x = -150;
    const sys = new MissileSystem<typeof t>(MISSILE_CONFIG);
    const m = sys.launch(shooter(), t);
    expect(m).not.toBeNull();
    if (!m) return;
    let prev = { ...m.velocity };
    let maxStep = 0;
    for (let i = 0; i < 60 * 4 && sys.missiles.count > 0; i++) {
      t.position.x += t.velocity.x * DT;
      sys.step([], null, DT);
      maxStep = Math.max(maxStep, angleBetween(prev, m.velocity));
      prev = { ...m.velocity };
    }
    expect(maxStep).toBeGreaterThan(0);
    expect(maxStep).toBeLessThanOrEqual(MISSILE_CONFIG.maxTurnDeg * DEG * DT + 1e-6);
  });

  it('発射後 straightSeconds は直進し、その後に目標へ曲がる', () => {
    const t = point(600, 0, -1200);
    const sys = new MissileSystem<typeof t>(MISSILE_CONFIG);
    const m = sys.launch(shooter(), t);
    if (!m) throw new Error('発射できない');
    const straight = Math.round(MISSILE_CONFIG.straightSeconds / DT) - 1;
    for (let i = 0; i < straight; i++) sys.step([], null, DT);
    expect(Math.abs(m.velocity.x)).toBeLessThan(1e-9);
    for (let i = 0; i < 30; i++) sys.step([], null, DT);
    expect(m.velocity.x).toBeGreaterThan(1);
  });

  it('周回ドローンを追尾して近接信管で撃墜する（ロック → 発射）', () => {
    const drone = new TargetDrone({
      centerX: 0,
      centerZ: 0,
      radius: 2000,
      altitude: 800,
      phase: Math.PI / 2,
    });
    // ドローンの 1.8km 後ろ下から機首を向ける
    const from = { x: -1800 * 0.2, y: 700, z: 2000 + 1700 };
    const to = drone.position;
    const q = lookQuat({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
    const s: Shooter = { position: from, orientation: q, speed: 250 };
    const combat = new CombatSystem(
      new TargetField(
        () => -10000,
        () => 0.5,
      ),
      null,
      () => 0.99,
      GUN_CONFIG,
      0.1,
      [drone],
    );
    const idle: CombatInput = {
      trigger: false,
      missile: false,
      flare: false,
      targetNext: false,
      rocket: false,
      bomb: false,
      bombHeld: false,
    };
    for (let i = 0; i < 120 && !combat.targeting.locked; i++) combat.step(idle, s, DT);
    expect(combat.targeting.selected).toBe(drone);
    expect(combat.targeting.locked).toBe(true);
    combat.step({ ...idle, missile: true }, s, DT);
    let exploded = 0;
    combat.onExplosion(() => exploded++);
    for (let i = 0; i < 60 * 10 && combat.kills === 0; i++) combat.step(idle, s, DT);
    expect(exploded).toBe(1);
    expect(drone.isDestroyed).toBe(true);
    expect(combat.kills).toBe(1);
  });
});

describe('近接信管と範囲ダメージ', () => {
  it('対象の半径 + fuseMargin 以内を通ると起爆する（外れると起爆しない）', () => {
    const r = 7;
    const near = point(r + MISSILE_CONFIG.fuseMargin - 1, 0, -300, r);
    const sys = new MissileSystem<typeof near>(MISSILE_CONFIG, (d) => hits.push(d.target));
    const hits: (typeof near | null)[] = [];
    sys.launch(shooter(), null);
    for (let i = 0; i < 120; i++) sys.step([near], null, DT);
    expect(hits).toEqual([near]);

    const far = point(r + MISSILE_CONFIG.fuseMargin + 1, 0, -300, r);
    hits.length = 0;
    sys.reset();
    sys.launch(shooter(), null);
    // 右のハードポイント（x = +2.6m）から出るので、その分も離す
    far.position.x += 2.6 * 2;
    for (let i = 0; i < 120; i++) sys.step([far], null, DT);
    expect(hits).toEqual([]);
  });

  it('信管が働く前（armSeconds）は起爆しない', () => {
    const t = point(0, -0.6, -60, 7);
    const hits: unknown[] = [];
    const sys = new MissileSystem<typeof t>(MISSILE_CONFIG, (d) => hits.push(d.target));
    sys.launch(shooter(250), null);
    for (let i = 0; i < Math.round(MISSILE_CONFIG.armSeconds / DT) - 2; i++)
      sys.step([t], null, DT);
    expect(hits).toEqual([]);
  });

  it('範囲ダメージは中心ほど大きく、半径の縁で edgeFraction 倍、外は 0', () => {
    const s = MISSILE_CONFIG;
    expect(splashDamage(s, 0)).toBe(s.maxDamage);
    expect(splashDamage(s, s.blastRadius / 2)).toBeCloseTo(
      (s.maxDamage * (1 + s.edgeFraction)) / 2,
    );
    expect(splashDamage(s, s.blastRadius - 1e-9)).toBeCloseTo(s.maxDamage * s.edgeFraction);
    expect(splashDamage(s, s.blastRadius)).toBe(0);
    expect(splashDamage(s, 1000)).toBe(0);
    for (let d = 0; d < s.blastRadius; d += 1)
      expect(splashDamage(s, d + 1)).toBeLessThan(splashDamage(s, d));
    // 信管の範囲いっぱいで起爆しても的・ドローンは 1 発
    expect(splashDamage(s, s.fuseMargin)).toBeGreaterThanOrEqual(TARGET_CONFIG.maxHp);
    expect(splashDamage(s, s.fuseMargin)).toBeGreaterThanOrEqual(DRONE_CONFIG.maxHp);
  });

  it('寿命切れで消え、地面に当たると起爆して消える', () => {
    const sys = new MissileSystem<FuseTarget>(MISSILE_CONFIG);
    sys.launch(shooter(250, IDENTITY, 50000), null);
    for (let i = 0; i < Math.round(MISSILE_CONFIG.lifeSeconds / DT) - 1; i++)
      sys.step([], null, DT);
    expect(sys.missiles.count).toBe(1);
    sys.step([], null, DT);
    sys.step([], null, DT);
    expect(sys.missiles.count).toBe(0);

    let ground = 0;
    const g = new MissileSystem<FuseTarget>(
      MISSILE_CONFIG,
      (d) => d.target === null && ground++,
      () => 0,
    );
    // 機首 30° 下げで高度 100m から撃つ
    g.launch(shooter(250, lookQuat({ x: 0, y: -0.5, z: -0.866 }), 100), null);
    for (let i = 0; i < 120; i++) g.step([], null, DT);
    expect(ground).toBe(1);
    expect(g.missiles.count).toBe(0);
  });

  it('燃焼後は誘導せず重力で落ちる', () => {
    const t = point(0, 0, -100000);
    const sys = new MissileSystem<typeof t>(MISSILE_CONFIG);
    const m = sys.launch(shooter(250, IDENTITY, 5000), t);
    if (!m) throw new Error('発射できない');
    for (let i = 0; i < Math.round((MISSILE_CONFIG.burnSeconds + 1) / DT); i++)
      sys.step([], null, DT);
    expect(m.target).toBeNull();
    expect(m.velocity.y).toBeLessThan(-5);
  });
});

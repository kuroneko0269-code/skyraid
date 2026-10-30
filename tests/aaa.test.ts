// 対空砲（2-6）: 予測射撃・難易度ごとの命中率・射程・バーストと警告・ミッションでのダメージ
import { describe, expect, it } from 'vitest';
import { AntiAirFire, ballisticLead } from '../src/combat/aaa';
import { createRandom } from '../src/core/random';
import type { Difficulty } from '../src/data/ai';
import { AAA_CONFIG } from '../src/data/ground-targets';
import { GroundTarget } from '../src/entities/ground-target';
import { vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';

const DT = 1 / 60;

/** 等速直線で飛ぶ偽の自機 */
function straightTarget(x: number, y: number, z: number, vx: number, vz: number) {
  return {
    position: { x, y, z },
    velocity: { x: vx, y: 0, z: vz },
    hitRadius: 6,
    active: true,
    move(dt: number) {
      this.position.x += this.velocity.x * dt;
      this.position.z += this.velocity.z * dt;
    },
  };
}

function aaaSite(difficulty: Difficulty = 'normal'): GroundTarget {
  const g = new GroundTarget(() => 0);
  g.deploy('g', 'aaa', 0, 0, difficulty);
  return g;
}

describe('対空砲の予測射撃', () => {
  it('予測点へ撃った弾（重力で落ちる）は、等速で横切る対象に当たる', () => {
    const out = vec3();
    const from = { x: 0, y: 4.6, z: 0 };
    const pos = { x: -1500, y: 900, z: -1200 };
    const vel = { x: 250, y: 0, z: 30 };
    const t = ballisticLead(out, from, 600, pos, vel, { x: 0, y: 0, z: 0 }, 9.8);
    expect(t).toBeGreaterThan(2);
    // 弾を t 秒飛ばすと、対象の t 秒後の位置に着く
    const dx = out.x - from.x;
    const dy = out.y - from.y;
    const dz = out.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    const shell = {
      x: from.x + (dx / len) * 600 * t,
      y: from.y + (dy / len) * 600 * t - 0.5 * 9.8 * t * t,
      z: from.z + (dz / len) * 600 * t,
    };
    const target = { x: pos.x + vel.x * t, y: pos.y, z: pos.z + vel.z * t };
    expect(Math.hypot(shell.x - target.x, shell.y - target.y, shell.z - target.z)).toBeLessThan(
      0.5,
    );
  });

  it('加速度を見込むと、一定の加速度で動く対象にも当たる', () => {
    const out = vec3();
    const from = { x: 0, y: 0, z: 0 };
    const pos = { x: -1200, y: 1000, z: -800 };
    const vel = { x: 200, y: 0, z: 0 };
    const acc = { x: 0, y: 30, z: -20 };
    const t = ballisticLead(out, from, 600, pos, vel, acc, 9.8);
    const len = Math.hypot(out.x, out.y, out.z);
    const shell = {
      x: (out.x / len) * 600 * t,
      y: (out.y / len) * 600 * t - 0.5 * 9.8 * t * t,
      z: (out.z / len) * 600 * t,
    };
    const target = {
      x: pos.x + vel.x * t,
      y: pos.y + 0.5 * acc.y * t * t,
      z: pos.z + 0.5 * acc.z * t * t,
    };
    expect(Math.hypot(shell.x - target.x, shell.y - target.y, shell.z - target.z)).toBeLessThan(
      0.5,
    );
  });

  it('命中率は難易度で変わる（等速直線の対象: easy 15% / normal 30% / hard 45%）', () => {
    const rates: Record<string, number> = {};
    for (const d of ['easy', 'normal', 'hard'] as const) {
      let hits = 0;
      let shots = 0;
      // 向き・高さを変えながら 30 回横切らせる（1 回 16 秒）
      for (let pass = 0; pass < 30; pass++) {
        const a = (pass / 30) * Math.PI * 2;
        const target = straightTarget(
          Math.cos(a) * 2000,
          700 + (pass % 10) * 50,
          Math.sin(a) * 2000 - 1000,
          -Math.sin(a) * 250,
          Math.cos(a) * 250,
        );
        const aaa = new AntiAirFire(
          () => {
            hits++;
          },
          () => 0,
          createRandom(100 + pass),
        );
        const site = aaaSite(d);
        for (let i = 0; i < 16 * 60; i++) {
          target.move(DT);
          aaa.step([site], target, DT);
        }
        // 飛んでいる弾も最後まで
        for (let i = 0; i < 8 * 60; i++) {
          target.move(DT);
          aaa.step([], target, DT);
        }
        shots += aaa.shotCount;
      }
      rates[d] = hits / shots;
      expect(shots).toBeGreaterThan(250);
    }
    expect(rates.easy).toBeGreaterThan(0.1);
    expect(rates.easy).toBeLessThan(0.2);
    expect(rates.normal).toBeGreaterThan(0.24);
    expect(rates.normal).toBeLessThan(0.36);
    expect(rates.hard).toBeGreaterThan(0.38);
    expect(rates.hard).toBeLessThan(0.52);
    expect(AAA_CONFIG.hitChance).toEqual({ easy: 0.15, normal: 0.3, hard: 0.45 });
  });

  it('外す弾は予測点から 18〜45m ずれた所を通る（自機の当たり判定 6m に当たらない）', () => {
    let hits = 0;
    const target = straightTarget(-2200, 800, -900, 250, 0);
    const aaa = new AntiAirFire(
      () => {
        hits++;
      },
      () => 0,
      // 命中の抽選で必ず外れる（0.99）
      () => 0.99,
    );
    const site = aaaSite('hard');
    for (let i = 0; i < 16 * 60; i++) {
      target.move(DT);
      aaa.step([site], target, DT);
    }
    expect(aaa.shotCount).toBeGreaterThan(20);
    expect(hits).toBe(0);
  });
});

describe('対空砲のバーストと警告', () => {
  it('600〜2500m だけ撃つ。範囲に入って 1 秒後に 5 発、以後 2 秒ごとに 5 発。撃つ前の 1 秒は警告', () => {
    const target = straightTarget(0, 1500, -1500, 0, 0);
    const aaa = new AntiAirFire(undefined, () => 0, createRandom(1));
    const site = aaaSite();
    const shotsAt: number[] = [];
    const warnAt: number[] = [];
    let last = 0;
    for (let i = 1; i <= 6 * 60; i++) {
      aaa.step([site], target, DT);
      if (aaa.shotCount !== last) {
        for (let k = last; k < aaa.shotCount; k++) shotsAt.push(i * DT);
        last = aaa.shotCount;
      }
      if (aaa.warning) warnAt.push(i * DT);
    }
    // 1.0 秒から 5 発（0.08 秒おき）、3.0 秒・5.0 秒からも 5 発
    expect(shotsAt.length).toBe(15);
    expect(shotsAt[0]).toBeCloseTo(1, 1);
    expect((shotsAt[4] ?? 0) - (shotsAt[0] ?? 0)).toBeCloseTo(0.32, 1);
    expect(shotsAt[5]).toBeCloseTo(3, 1);
    expect(shotsAt[10]).toBeCloseTo(5, 1);
    // 警告: 0〜1 秒・2〜3 秒・4〜5 秒（撃つ前の 1 秒）だけ
    expect(warnAt[0]).toBeCloseTo(DT, 6);
    expect(warnAt.some((t) => t > 1.1 && t < 1.9)).toBe(false);
    expect(warnAt.some((t) => t > 2.1 && t < 2.9)).toBe(true);
    // 砲身は自機の方（北の上空）を向く
    expect(Math.abs(site.gun.yaw)).toBeLessThan(0.05);
    expect(site.gun.pitch).toBeGreaterThan(0.6);
  });

  it('近すぎる（600m 未満）・遠すぎる（2500m 超）・壊れた対空砲は撃たない', () => {
    for (const [z, y] of [
      [-300, 300],
      [-2600, 600],
    ] as const) {
      const aaa = new AntiAirFire(undefined, () => 0, createRandom(1));
      const site = aaaSite();
      const target = straightTarget(0, y, z, 0, 0);
      for (let i = 0; i < 5 * 60; i++) aaa.step([site], target, DT);
      expect(aaa.shotCount).toBe(0);
      expect(aaa.warning).toBe(false);
    }
    const aaa = new AntiAirFire(undefined, () => 0, createRandom(1));
    const site = aaaSite();
    site.applyDamage(1000);
    for (let i = 0; i < 5 * 60; i++) aaa.step([site], straightTarget(0, 1500, -1500, 0, 0), DT);
    expect(aaa.shotCount).toBe(0);
  });

  it('ミッションでは対空砲の弾が自機に 1 発 8 ダメージ。水平直線で横切ると normal で約 3 割が当たる', () => {
    const s = new FlightSession({ rng: createRandom(3) });
    // 地形なし（地面 0）。対空砲の 2km 西から東へ、高度 800m を水平に
    s.startMission({ x: -2000, y: 800, z: -600, headingDeg: 90 });
    s.spawn({
      kind: 'groundTarget',
      group: 'g',
      targetType: 'aaa',
      trigger: { type: 'start' },
      positions: [{ x: 0, z: 0 }],
      difficulty: 'normal',
    });
    const controls = {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttle: 0,
      afterburner: false,
      throttleTarget: null,
    };
    const none = {
      trigger: false,
      missile: false,
      flare: false,
      targetNext: false,
      rocket: false,
      bomb: false,
      bombHeld: false,
    };
    // 25 秒（射程を抜けるのは約 18 秒後。残りの弾も届くまで）
    for (let i = 0; i < 25 * 60; i++) s.step(controls, none, DT);
    const shots = s.props.aaa.shotCount;
    const hits = s.player.damageTaken / AAA_CONFIG.damage;
    expect(Number.isInteger(hits)).toBe(true);
    expect(shots).toBeGreaterThan(35);
    expect(hits / shots).toBeGreaterThan(0.15);
    expect(hits / shots).toBeLessThan(0.45);
  });
});

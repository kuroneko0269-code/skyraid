import { describe, expect, it } from 'vitest';
import { ISLAND_MAP } from '../src/data/maps';
import {
  RANKING_CONFIG,
  computeRank,
  rankFromScore,
  rankScore,
  rewardCredits,
} from '../src/data/ranking';
import { RING_CONFIG } from '../src/data/rings';
import { BoundaryWatch } from '../src/missions/boundary';
import { createRing, crossesRing } from '../src/missions/objectives/ring';

describe('戦域の境界', () => {
  it('島は中心 (0, 0)・半径 6000m・猶予 10 秒', () => {
    expect(ISLAND_MAP.center).toEqual({ x: 0, z: 0 });
    expect(ISLAND_MAP.radius).toBe(6000);
    expect(ISLAND_MAP.returnSeconds).toBe(10);
  });

  it('外に出ると警告してカウントし、戻ると猶予が満タンに戻る', () => {
    const b = new BoundaryWatch(ISLAND_MAP, true);
    b.step(0, 5999, 1 / 60);
    expect(b.outside).toBe(false);
    for (let i = 0; i < 300; i++) b.step(4300, 4300, 1 / 60); // 半径 約 6081m
    expect(b.outside).toBe(true);
    expect(b.secondsLeft).toBeCloseTo(5, 5);
    b.step(0, 0, 1 / 60);
    expect(b.outside).toBe(false);
    expect(b.secondsLeft).toBe(10);
    for (let i = 0; i < 601; i++) b.step(0, -6100, 1 / 60);
    expect(b.expired).toBe(true);
  });

  it('フリーフライト（failOnExpire = false）は警告だけで数えない', () => {
    const b = new BoundaryWatch(ISLAND_MAP, false);
    for (let i = 0; i < 60 * 30; i++) b.step(7000, 0, 1 / 60);
    expect(b.outside).toBe(true);
    expect(b.expired).toBe(false);
    expect(b.secondsLeft).toBe(10);
  });
});

describe('ランク', () => {
  it('基準時間以内・被弾なしは S、時間と被弾で下がる', () => {
    expect(rankScore(60, 60, 0, 200)).toBe(100);
    expect(computeRank(50, 60, 0, 200)).toBe('S');
    // 1.2 倍の時間（−10）と 20% の被弾（−10）で 80 点
    expect(rankScore(72, 60, 40, 200)).toBeCloseTo(80, 5);
    expect(computeRank(72, 60, 40, 200)).toBe('A');
    // 2 倍の時間で時間の減点は最大（50）、それ以上は増えない
    expect(rankScore(120, 60, 0, 200)).toBeCloseTo(50, 5);
    expect(rankScore(600, 60, 0, 200)).toBeCloseTo(50, 5);
    expect(computeRank(120, 60, 0, 200)).toBe('C');
    expect(computeRank(90, 60, 0, 200)).toBe('A'); // 75 点
    expect(computeRank(95, 60, 0, 200)).toBe('B');
  });

  it('しきい値の境目', () => {
    const t = RANKING_CONFIG.thresholds;
    expect(rankFromScore(t.S)).toBe('S');
    expect(rankFromScore(t.S - 0.01)).toBe('A');
    expect(rankFromScore(t.A - 0.01)).toBe('B');
    expect(rankFromScore(t.B - 0.01)).toBe('C');
  });

  it('報酬 = 基本額 × ランク倍率', () => {
    expect(rewardCredits(1000, 'S')).toBe(2000);
    expect(rewardCredits(1000, 'A')).toBe(1500);
    expect(rewardCredits(1000, 'B')).toBe(1200);
    expect(rewardCredits(1000, 'C')).toBe(1000);
    expect(rewardCredits(1000, 'S', { S: 3, A: 2, B: 1, C: 0.5 })).toBe(3000);
  });
});

describe('リングの通過判定', () => {
  const ring = createRing({ x: 0, y: 100, z: 0, headingDeg: 90 }); // 法線は +X

  it('法線は機首の向き（-Z から右回り）と上向きの角度から', () => {
    expect(ring.normal.x).toBeCloseTo(1, 9);
    expect(ring.normal.z).toBeCloseTo(0, 9);
    const up = createRing({ x: 0, y: 0, z: 0, headingDeg: 0, pitchDeg: 90 });
    expect(up.normal.y).toBeCloseTo(1, 9);
    expect(ring.passRadius).toBe(RING_CONFIG.passRadius);
  });

  it('輪の中を横切れば通過（どちら向きでも）。1 ステップで大きく進んでも線分で拾う', () => {
    expect(crossesRing(ring, { x: -2, y: 100, z: 0 }, { x: 2, y: 100, z: 0 })).toBe(true);
    expect(crossesRing(ring, { x: 2, y: 110, z: 10 }, { x: -2, y: 110, z: 10 })).toBe(true);
    expect(crossesRing(ring, { x: -400, y: 100, z: 0 }, { x: 400, y: 100, z: 0 })).toBe(true);
  });

  it('輪の外・面を横切らない・面に沿って動くのは通過ではない', () => {
    const r = RING_CONFIG.passRadius;
    expect(crossesRing(ring, { x: -1, y: 100 + r + 1, z: 0 }, { x: 1, y: 100 + r + 1, z: 0 })).toBe(
      false,
    );
    expect(crossesRing(ring, { x: 1, y: 100, z: 0 }, { x: 5, y: 100, z: 0 })).toBe(false);
    expect(crossesRing(ring, { x: 0, y: 100, z: -5 }, { x: 0, y: 100, z: 5 })).toBe(false);
    // 斜めに横切って、面との交点が半径の外
    expect(crossesRing(ring, { x: -10, y: 100, z: 0 }, { x: 10, y: 100, z: 2 * (r + 5) })).toBe(
      false,
    );
  });
});

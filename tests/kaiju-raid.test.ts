// レイドの所要時間のボットと怪獣のモデル（6-1 / 6-2。8-6 で難易度を上げ、熟練ボットで確かめる）
import { describe, expect, it } from 'vitest';
import { buildKaijuGeometries } from '../src/render/kaiju-model/kaiju-object';
import { runRaidBots } from './kaiju-raid-bots';

describe('モデル', () => {
  it('三角形: 「高」40,000 以下、「低」12,000 以下', () => {
    const hi = buildKaijuGeometries('high');
    const lo = buildKaijuGeometries('low');
    expect(hi.triangles).toBeLessThanOrEqual(40000);
    expect(lo.triangles).toBeLessThanOrEqual(12000);
    expect(lo.triangles).toBeLessThan(hi.triangles);
    // 10-7e: 部位（胴・頭・腕・脚・尾）と骨板は 1 つのメッシュ（頂点に部位の番号）+ 結晶
    expect(hi.skin.getAttribute('aPart').count).toBe(hi.skin.getAttribute('position').count);
  });
});

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] ?? 0) : ((v[m - 1] ?? 0) + (v[m] ?? 0)) / 2;
}

describe('ボット（8-6b: 通常は慣れた人で 2.5〜3.5 分・平均的な人も大半はクリア、高難度は 8-6 のまま）', () => {
  const times = (
    players: number,
    seeds: readonly number[],
    o: { skill?: 'skilled'; hard?: boolean },
  ) => seeds.map((seed) => runRaidBots({ players, seed, maxSeconds: 1200, ...o }));

  it('通常・熟練 1 人: すべて倒せる。中央値は 2.5〜3.5 分、各シードは 1.5〜4 分', () => {
    const rs = times(1, [1, 2, 3, 4, 5, 6, 7, 8], { skill: 'skilled' });
    for (const r of rs) {
      expect(r.killed).toBe(true);
      expect(r.seconds).toBeGreaterThanOrEqual(1.5 * 60);
      expect(r.seconds).toBeLessThanOrEqual(4 * 60);
      expect(r.breaks).toBe(0);
    }
    const m = median(rs.map((r) => r.seconds));
    expect(m).toBeGreaterThanOrEqual(2.5 * 60);
    expect(m).toBeLessThanOrEqual(3.5 * 60);
  }, 60000);

  it('通常・熟練 4 人: 1.5〜3 分で倒せる（8-6c: 1 人より遅くならない）。ブレイクも起きる', () => {
    for (const r of times(4, [1, 2, 3, 4, 5], { skill: 'skilled' })) {
      expect(r.killed).toBe(true);
      expect(r.seconds).toBeGreaterThanOrEqual(1.5 * 60);
      expect(r.seconds).toBeLessThanOrEqual(3 * 60);
      expect(r.breaks).toBeGreaterThan(0);
    }
  }, 60000);

  it('8-6c: 2〜4 人の熟練の中央値は 1 人以下（通常・高難度）。高難度 4 人は 8 シードすべて倒せる', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const hard of [false, true]) {
      const solo = median(times(1, seeds, { skill: 'skilled', hard }).map((r) => r.seconds));
      for (const players of [2, 3, 4]) {
        const rs = times(players, seeds, { skill: 'skilled', hard });
        expect([hard, players, median(rs.map((r) => r.seconds)) <= solo]).toEqual([
          hard,
          players,
          true,
        ]);
        if (hard && players === 4) expect(rs.every((r) => r.killed)).toBe(true);
      }
    }
  }, 240000);

  it('通常・平均的な 1 人（初見に近い腕前）: 8 回のうち失敗は 3 回以下、クリアは 12 分以内', () => {
    const rs = times(1, [1, 2, 3, 4, 5, 6, 7, 8], {});
    expect(rs.filter((r) => !r.killed).length).toBeLessThanOrEqual(3);
    for (const r of rs) if (r.killed) expect(r.seconds).toBeLessThanOrEqual(12 * 60);
  }, 120000);

  it('9-7 の事前修正: 通常・平均的な 1 人は 20 シード（0〜19・残機 3）で失敗 5 回以下（8-6b の目安。最終フェーズ 4.5 → 5.5 分）', () => {
    const rs = Array.from({ length: 20 }, (_, seed) =>
      runRaidBots({ players: 1, seed, maxSeconds: 1200, lives: 3 }),
    );
    expect(rs.filter((r) => !r.killed).length).toBeLessThanOrEqual(5);
    for (const r of rs) if (r.killed) expect(r.seconds).toBeLessThanOrEqual(12 * 60);
  }, 120000);

  it('高難度・熟練 1 人: すべて倒せる。中央値は 4〜6 分（8-6 の数値のまま）', () => {
    const rs = times(1, [1, 2, 3, 4, 5, 6, 7, 8], { skill: 'skilled', hard: true });
    for (const r of rs) expect(r.killed).toBe(true);
    const m = median(rs.map((r) => r.seconds));
    expect(m).toBeGreaterThanOrEqual(4 * 60);
    expect(m).toBeLessThanOrEqual(6 * 60);
  }, 60000);
});

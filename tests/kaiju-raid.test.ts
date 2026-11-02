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
    // 部位ごとに別メッシュ: 胴・頭・腕・脚・尾 + 結晶
    expect(hi.skin.length).toBe(5);
  });
});

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] ?? 0) : ((v[m - 1] ?? 0) + (v[m] ?? 0)) / 2;
}

describe('ボット（8-6: 慣れた人で 3〜5 分・初見は失敗する）', () => {
  it('熟練 1 人: すべて倒せる。中央値は 3〜5 分、各シードは 2.5〜5.5 分', () => {
    const times: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = runRaidBots({ players: 1, seed, skill: 'skilled' });
      expect([seed, r.killed]).toEqual([seed, true]);
      expect(r.seconds).toBeGreaterThanOrEqual(2.5 * 60);
      expect(r.seconds).toBeLessThanOrEqual(5.5 * 60);
      expect(r.breaks).toBe(0);
      times.push(r.seconds);
    }
    const m = median(times);
    expect(m).toBeGreaterThanOrEqual(3 * 60);
    expect(m).toBeLessThanOrEqual(5 * 60);
  }, 60000);

  it('熟練 4 人: 4〜7 分で倒せる（人数に応じて同じ割合で上がる）。ブレイクも起きる', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = runRaidBots({ players: 4, seed, skill: 'skilled' });
      expect([seed, r.killed]).toEqual([seed, true]);
      expect(r.seconds).toBeGreaterThanOrEqual(4 * 60);
      expect(r.seconds).toBeLessThanOrEqual(7 * 60);
      expect(r.breaks).toBeGreaterThan(0);
    }
  }, 60000);

  it('平均的な 1 人（初見に近い腕前）: 半分以上は失敗する', () => {
    let fails = 0;
    const seeds = [1, 2, 3, 4, 5, 6];
    for (const seed of seeds) {
      const r = runRaidBots({ players: 1, seed, maxSeconds: 1200 });
      if (!r.killed) fails++;
    }
    expect(fails).toBeGreaterThanOrEqual(seeds.length / 2);
  }, 60000);
});

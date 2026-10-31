// レイドの所要時間のボットと怪獣のモデル（6-1 / 6-2）
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

describe('ボット（Kestrel Lv0・平均的な命中率）', () => {
  it('4 人で 7〜9 分で倒せる', () => {
    for (const seed of [1, 3, 4, 5, 6]) {
      const r = runRaidBots({ players: 4, seed });
      expect([seed, r.killed]).toEqual([seed, true]);
      expect(r.seconds).toBeGreaterThanOrEqual(7 * 60);
      expect(r.seconds).toBeLessThanOrEqual(9 * 60);
      expect(r.breaks).toBeGreaterThan(5);
    }
  }, 60000);

  it('1 人で倒せる: 中央値は 5.5〜7 分、各シードは 4〜8.5 分（6-1b / 6-4 の港湾都市）', () => {
    const times: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = runRaidBots({ players: 1, seed });
      expect([seed, r.killed]).toEqual([seed, true]);
      expect(r.seconds).toBeGreaterThanOrEqual(4 * 60);
      expect(r.seconds).toBeLessThanOrEqual(8.5 * 60);
      expect(r.breaks).toBe(0);
      times.push(r.seconds);
    }
    times.sort((a, b) => a - b);
    const median = ((times[3] ?? 0) + (times[4] ?? 0)) / 2;
    expect(median).toBeGreaterThanOrEqual(5.5 * 60);
    expect(median).toBeLessThanOrEqual(7 * 60);
  }, 60000);
});

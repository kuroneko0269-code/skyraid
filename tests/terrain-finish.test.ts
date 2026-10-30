import { describe, expect, it } from 'vitest';
import { VEGETATION_CONFIG } from '../src/data/vegetation';
import { bakeCoastDistance } from '../src/render/coast-distance';
import { bakeDepthField, sampleDepthField } from '../src/render/ocean-depth';
import { defaultHeightField, smoothGrid } from '../src/render/terrain-height';
import { treeTints } from '../src/render/vegetation';

describe('浸食の差分のならし（4-8）', () => {
  it('[1, 2, 1] / 4 のならしは平らな格子を変えず、1 マスの市松模様を消す', () => {
    const res = 8;
    const flat = new Float32Array(res * res).fill(3);
    smoothGrid(flat, res, 1);
    expect([...flat].every((v) => Math.abs(v - 3) < 1e-6)).toBe(true);
    const checker = new Float32Array(res * res);
    for (let k = 0; k < checker.length; k++) checker[k] = ((k % res) + Math.floor(k / res)) % 2;
    smoothGrid(checker, res, 1);
    // 内側の点はすべて平均の 0.5 になる
    expect(checker[3 + 3 * res]).toBeCloseTo(0.5, 6);
    expect(checker[4 + 4 * res]).toBeCloseTo(0.5, 6);
  });

  it('山腹（海抜 30〜450m）で 30° を超える急な面の割合が浸食前の 1.15 倍以内（格子の段を作らない）', () => {
    const hf = defaultHeightField;
    const tan30 = Math.tan(Math.PI / 6);
    const steep = (g: (x: number, z: number) => number, x: number, z: number): boolean =>
      Math.hypot(g(x + 1, z) - g(x - 1, z), g(x, z + 1) - g(x, z - 1)) / 2 > tan30;
    let eroded = 0;
    let base = 0;
    for (let x = -2400; x <= 2400; x += 53) {
      for (let z = -2400; z <= 2400; z += 53) {
        const h = hf.getHeight(x, z);
        if (h < 30 || h > 450) continue;
        if (steep(hf.getHeight, x, z)) eroded++;
        if (steep(hf.getBaseHeight, x, z)) base++;
      }
    }
    expect(base).toBeGreaterThan(0);
    expect(eroded).toBeLessThanOrEqual(base * 1.15);
  });
});

describe('海岸線からの距離（4-8）', () => {
  // 半径 1000m の円い島（中心 50m、海岸から外へ下がる円錐）
  const cone = (x: number, z: number): number => 50 * (1 - Math.hypot(x, z) / 1000);
  const depth = bakeDepthField(cone, 4000, 200);
  const field = { ...depth, data: bakeCoastDistance(depth) };

  it('陸は正・海は負で、円の海岸線までの距離とマス 1 つ（20m）以内で合う。海岸近くは 5m 以内', () => {
    for (const [x, z] of [
      [0, 0],
      [300, 400],
      [-700, 100],
      [0, -950],
      [1300, 0],
      [-900, -900],
    ] as const) {
      const expected = 1000 - Math.hypot(x, z);
      // 中心は距離の尖り（最大）を双線形で丸めるので少しずれる
      expect(Math.abs(sampleDepthField(field, x, z) - expected)).toBeLessThan(20);
    }
    for (const [x, z] of [
      [0, -950],
      [980, 60],
      [-640, 790],
    ] as const) {
      const expected = 1000 - Math.hypot(x, z);
      expect(Math.abs(sampleDepthField(field, x, z) - expected)).toBeLessThan(5);
    }
  });

  it('海岸線の無い格子（全部海）は遠い海として扱う', () => {
    const sea = bakeDepthField(() => -10, 1000, 16);
    const data = bakeCoastDistance(sea, 5000);
    expect([...data].every((v) => v === -5000)).toBe(true);
  });

  it('既定の島の風下の浜: 海岸から 80m 内陸は距離 60〜100m（砂浜の幅の判定に使える精度）', () => {
    const d = bakeDepthField(defaultHeightField.getHeight, 8000, 384);
    const coast = { ...d, data: bakeCoastDistance(d) };
    const a = (30 * Math.PI) / 180;
    let r = 2500;
    while (defaultHeightField.getHeight(r * Math.cos(a), r * Math.sin(a)) > 0) r += 1;
    const inland = sampleDepthField(coast, (r - 80) * Math.cos(a), (r - 80) * Math.sin(a));
    expect(inland).toBeGreaterThan(60);
    expect(inland).toBeLessThan(100);
  });
});

describe('近くの木の個体差（4-8）', () => {
  const seeds = new Float32Array(400);
  for (let i = 0; i < seeds.length; i++) seeds[i] = (i * 0.618034) % 1;
  const { foliage, trunk } = treeTints(seeds, seeds.length);
  const v = VEGETATION_CONFIG.colors.nearVariation;

  it('同じ seed なら同じ色。葉と幹は別の値', () => {
    const again = treeTints(seeds, seeds.length);
    expect([...again.foliage]).toEqual([...foliage]);
    let differs = 0;
    for (let t = 0; t < seeds.length; t++) {
      if (Math.abs((foliage[t * 3] ?? 0) - (trunk[t * 3] ?? 0)) > 0.02) differs++;
    }
    expect(differs).toBeGreaterThan(seeds.length / 2);
  });

  it('倍率は明るさ ±lightness と色相のずれの範囲で、ばらついている', () => {
    // 色相 ±10° のずれで成分の比は 1 から数十 % まで動きうるので、緑（葉の主成分）で明るさの幅を確かめる
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < seeds.length; t++) {
      const g = foliage[t * 3 + 1] ?? 0;
      min = Math.min(min, g);
      max = Math.max(max, g);
      for (let c = 0; c < 3; c++) {
        const f = foliage[t * 3 + c] ?? 0;
        expect(f).toBeGreaterThan(0.5);
        expect(f).toBeLessThan(1.6);
      }
    }
    expect(max - min).toBeGreaterThan(v.lightness);
    expect(max).toBeLessThan(1 + v.lightness + 0.15);
    expect(min).toBeGreaterThan(1 - v.lightness - 0.15);
  });
});

import { describe, expect, it } from 'vitest';
import { CLOUD_CONFIG } from '../src/data/clouds';
import {
  cloudDensity,
  cloudDensityAt,
  cloudHeightProfile,
  createCloudNoise,
  sampleCloudNoise,
} from '../src/render/cloud-noise';
import { insideLayerAmount } from '../src/render/clouds';
import { createRandom } from '../src/core/random';

const noise = createCloudNoise(16, 7);

describe('雲の密度', () => {
  it('被覆率を上げると、どの点でも密度は下がらない', () => {
    const random = createRandom(3);
    for (let i = 0; i < 2000; i++) {
      const shape = random();
      const detail = random();
      const hf = random();
      const c1 = random();
      const c2 = Math.min(1, c1 + 0.05 + random() * 0.5);
      expect(cloudDensity(shape, detail, hf, c2)).toBeGreaterThanOrEqual(
        cloudDensity(shape, detail, hf, c1),
      );
    }
  });

  it('被覆率を上げると、層全体の平均の密度が増える', () => {
    const mean = (coverage: number): number => {
      let sum = 0;
      let n = 0;
      for (let x = 0; x < 8000; x += 170) {
        for (let z = 0; z < 8000; z += 190) {
          for (const y of [1580, 1700, 1850, 2000]) {
            sum += cloudDensityAt(noise, x, y, z, 0, 0, { ...CLOUD_CONFIG, coverage });
            n++;
          }
        }
      }
      return sum / n;
    };
    const values = [0.2, 0.45, 0.7, 0.95].map(mean);
    for (let i = 1; i < values.length; i++) {
      expect(values[i] ?? 0).toBeGreaterThan(values[i - 1] ?? 0);
    }
    expect(values[0]).toBeLessThan(0.05);
  });

  it('密度は 0〜1。層の外（1500m より下、2200m より上）は 0', () => {
    for (const y of [0, 1499, 2201, 5000]) {
      expect(cloudDensityAt(noise, 100, y, 200, 0, 0)).toBe(0);
    }
    expect(cloudHeightProfile(0)).toBe(0);
    expect(cloudHeightProfile(1)).toBe(0);
    expect(cloudHeightProfile(0.3)).toBeGreaterThan(0.5);
    const random = createRandom(5);
    for (let i = 0; i < 500; i++) {
      const d = cloudDensity(random(), random(), random(), random());
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('底は平ら（すぐ立ち上がる）で、上は丸く細る', () => {
    // 下端から 10% で最大、上へ行くほど小さい
    expect(cloudHeightProfile(0.1)).toBeCloseTo(1, 6);
    expect(cloudHeightProfile(0.6)).toBeLessThan(cloudHeightProfile(0.3));
    expect(cloudHeightProfile(0.9)).toBeLessThan(cloudHeightProfile(0.6));
  });

  it('風で流すと模様がそのまま動く', () => {
    const a = cloudDensityAt(noise, 500, 1700, 900, 0, 0);
    const b = cloudDensityAt(noise, 500 + 300, 1700, 900 - 120, 300, -120);
    expect(b).toBeCloseTo(a, 9);
  });
});

describe('雲の 3D ノイズ', () => {
  it('0〜255 を使い切り、端がつながる（タイル状）', () => {
    let min = 255;
    let max = 0;
    for (const v of noise.data) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBe(0);
    expect(max).toBe(255);
    for (const [u, v, w] of [
      [0.1, 0.2, 0.3],
      [0.97, 0.01, 0.5],
    ] as const) {
      const a = sampleCloudNoise(noise, u, v, w);
      expect(sampleCloudNoise(noise, u + 1, v, w)).toBeCloseTo(a, 9);
      expect(sampleCloudNoise(noise, u, v - 1, w + 2)).toBeCloseTo(a, 9);
    }
  });

  it('同じシードなら同じノイズ', () => {
    expect(createCloudNoise(8, 99).data).toEqual(createCloudNoise(8, 99).data);
  });
});

describe('雲の中の霧', () => {
  it('層の中にいる度合いは層の端でなめらかに 0 → 1', () => {
    const { base, top } = CLOUD_CONFIG;
    const edge = CLOUD_CONFIG.insideFog.edge;
    expect(insideLayerAmount(base - 10, base, top, edge)).toBe(0);
    expect(insideLayerAmount(top + 10, base, top, edge)).toBe(0);
    expect(insideLayerAmount(1800, base, top, edge)).toBe(1);
    expect(insideLayerAmount(base + edge / 2, base, top, edge)).toBeCloseTo(0.5, 9);
  });
});

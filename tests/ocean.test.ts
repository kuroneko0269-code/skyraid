import { describe, expect, it } from 'vitest';
import { OCEAN_CONFIG } from '../src/data/ocean';
import { TERRAIN_CONFIG } from '../src/data/terrain';
import {
  buildGerstnerWaves,
  gerstnerDisplacement,
  gerstnerHeight,
  maxWaveHeight,
  rippleFalloff,
  shoalFactor,
  wavePeriod,
} from '../src/render/gerstner';
import { bakeDepthField, sampleDepthField, waterDepth } from '../src/render/ocean-depth';
import { ringRadii } from '../src/render/ocean-mesh';
import { getHeight } from '../src/render/terrain-height';

const waves = buildGerstnerWaves();

describe('ゲルストナー波', () => {
  it('うねり 2 本 + 風波 4 本', () => {
    expect(waves).toHaveLength(6);
    // 先頭 2 本（うねり）は風波より長い
    const swell = Math.min(OCEAN_CONFIG.waves[0].wavelength, OCEAN_CONFIG.waves[1].wavelength);
    for (const w of OCEAN_CONFIG.waves.slice(2)) expect(w.wavelength).toBeLessThan(swell);
  });

  it('1 本ずつ見ると、進む向きに波長ぶん・周期ぶんで元に戻る', () => {
    for (const w of waves) {
      const len = (2 * Math.PI) / w.k;
      const T = wavePeriod(w);
      for (const [x, z, t] of [
        [0, 0, 0],
        [123.4, -56.7, 3.2],
        [-800, 950, 41],
      ] as const) {
        const h = gerstnerHeight([w], x, z, t);
        expect(gerstnerHeight([w], x + w.dirX * len, z + w.dirZ * len, t)).toBeCloseTo(h, 6);
        expect(gerstnerHeight([w], x, z, t + T)).toBeCloseTo(h, 6);
        // 進む向きと垂直に動いても変わらない（平面波）
        expect(gerstnerHeight([w], x - w.dirZ * 37, z + w.dirX * 37, t)).toBeCloseTo(h, 6);
      }
    }
  });

  it('高さは振幅の合計を超えず、振幅の合計は 1.5m 以下（船酔い防止）', () => {
    const max = maxWaveHeight(waves);
    expect(max).toBeLessThanOrEqual(OCEAN_CONFIG.maxAmplitude);
    expect(max).toBeLessThanOrEqual(1.5);
    let peak = 0;
    for (let x = -600; x <= 600; x += 37) {
      for (let z = -600; z <= 600; z += 41) {
        for (const t of [0, 7.3, 19.1])
          peak = Math.max(peak, Math.abs(gerstnerHeight(waves, x, z, t)));
      }
    }
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThanOrEqual(max + 1e-9);
  });

  it('鋭さの合計 < 1（波の頂点が輪にならない）、水平の寄りは鋭さ / 波数以下', () => {
    const sum = waves.reduce((s, w) => s + w.steepness, 0);
    expect(sum).toBeLessThan(1);
    const out = { x: 0, y: 0, z: 0 };
    const side = waves.reduce((s, w) => s + w.steepness / w.k, 0);
    for (let x = 0; x < 300; x += 23) {
      gerstnerDisplacement(waves, x, -x, 5, out);
      expect(Math.hypot(out.x, out.z)).toBeLessThanOrEqual(side + 1e-9);
    }
  });

  it('深海の分散関係: 長い波ほど速い', () => {
    const speeds = waves.map((w) => ({ len: (2 * Math.PI) / w.k, c: w.omega / w.k }));
    speeds.sort((a, b) => a.len - b.len);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]?.c ?? 0).toBeGreaterThan(speeds[i - 1]?.c ?? 0);
    }
  });

  it('風向きを 1 つ変えると全部の波が同じだけ回る', () => {
    const a = buildGerstnerWaves(OCEAN_CONFIG.waves, 0);
    const b = buildGerstnerWaves(OCEAN_CONFIG.waves, 90);
    a.forEach((w, i) => {
      const r = b[i];
      // 90° 回すと (x, z) → (−z, x)
      expect(r?.dirX).toBeCloseTo(-w.dirZ, 9);
      expect(r?.dirZ).toBeCloseTo(w.dirX, 9);
    });
  });

  it('浅瀬では波が消える（海岸で 0、深いところで 1）', () => {
    expect(shoalFactor(0)).toBe(0);
    expect(shoalFactor(-3)).toBe(0);
    expect(shoalFactor(OCEAN_CONFIG.shoal.fullDepth)).toBe(1);
    expect(shoalFactor(60)).toBe(1);
    const out = { x: 0, y: 0, z: 0 };
    gerstnerDisplacement(waves, 10, 20, 3, out, shoalFactor(0));
    expect(out.y).toBe(0);
  });
});

describe('水深', () => {
  const field = bakeDepthField(getHeight, TERRAIN_CONFIG.size, 128, TERRAIN_CONFIG.seaLevel);

  it('水深 = 海面 − 地形の高さ（陸は負）', () => {
    expect(waterDepth(-12)).toBe(12);
    expect(waterDepth(30)).toBe(-30);
    expect(waterDepth(-12, 2)).toBe(14);
  });

  it('島の中心は陸、沖は海底の深さ（60m）', () => {
    expect(sampleDepthField(field, 0, 0)).toBeLessThan(-100);
    expect(sampleDepthField(field, 3900, 3900)).toBeCloseTo(TERRAIN_CONFIG.shape.seaDepth, 3);
    // 範囲の外は端の値（ずっと沖）
    expect(sampleDepthField(field, 20000, -20000)).toBeCloseTo(TERRAIN_CONFIG.shape.seaDepth, 3);
  });

  it('格子の点では地形の高さ関数と一致し、間は隣の値の間になる', () => {
    const cell = field.size / field.resolution;
    const half = field.size / 2;
    for (const [i, j] of [
      [10, 64],
      [64, 100],
      [100, 30],
    ] as const) {
      const x = -half + (i + 0.5) * cell;
      const z = -half + (j + 0.5) * cell;
      expect(sampleDepthField(field, x, z)).toBeCloseTo(waterDepth(getHeight(x, z)), 4);
      const a = sampleDepthField(field, x, z);
      const b = sampleDepthField(field, x + cell, z);
      const mid = sampleDepthField(field, x + cell / 2, z);
      expect(mid).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-6);
      expect(mid).toBeLessThanOrEqual(Math.max(a, b) + 1e-6);
    }
  });

  it('海岸から沖へ向かうと水深が増える', () => {
    let prev = -Infinity;
    for (let z = 3400; z <= 3990; z += 30) {
      const d = sampleDepthField(field, 0, z);
      expect(d).toBeGreaterThanOrEqual(prev - 0.5);
      prev = d;
    }
  });
});

describe('海面の同心リング', () => {
  it('内側から外側へ等比で広がり、両端がちょうど指定の半径', () => {
    const r = ringRadii(2, 5500, 160);
    expect(r[0]).toBeCloseTo(2, 9);
    expect(r[r.length - 1]).toBeCloseTo(5500, 6);
    const ratio = (r[1] ?? 0) / (r[0] ?? 1);
    // 隣の輪との間隔 ≒ 円周方向の間隔（比 ≦ 1 + 2π / 分割数）
    expect(ratio).toBeLessThanOrEqual(1 + (2 * Math.PI) / 160 + 1e-9);
    for (let i = 1; i < r.length; i++) {
      expect((r[i] ?? 0) / (r[i - 1] ?? 1)).toBeCloseTo(ratio, 9);
    }
  });

  it('画質「高」の描画距離でも頂点は 4 万以下', () => {
    const segments = OCEAN_CONFIG.rings.angularSegments;
    const rings = ringRadii(
      OCEAN_CONFIG.rings.innerRadius,
      8000 * OCEAN_CONFIG.rings.outerRatio,
      segments,
    );
    expect(1 + rings.length * segments).toBeLessThanOrEqual(40_000);
  });
});

describe('さざ波と照り返し（4-2b）', () => {
  it('さざ波の振幅は 500m で 50%、2000m で約 10%', () => {
    expect(rippleFalloff(0)).toBe(1);
    expect(rippleFalloff(500)).toBeCloseTo(0.5, 5);
    expect(rippleFalloff(2000)).toBeGreaterThan(0.08);
    expect(rippleFalloff(2000)).toBeLessThan(0.12);
  });

  it('遠いほど弱くなる', () => {
    let prev = 1;
    for (const d of [100, 300, 800, 1500, 3000, 6000]) {
      const k = rippleFalloff(d);
      expect(k).toBeLessThan(prev);
      prev = k;
    }
  });

  it('照り返しの帯は内側 < 外側、帯の外はブルームのしきい値より暗く頭打ち', () => {
    const b = OCEAN_CONFIG.sunGlint.band;
    expect(b.inner).toBeLessThan(b.outer);
    expect(b.outsideScale).toBeLessThan(0.5);
    // しきい値は露出後の明るさ（露出の上限 3 でも超えない）
    expect(b.outsideMax * 3).toBeLessThan(2.2);
  });

  it('画素より細かいさざ波は消す範囲が正しい順', () => {
    const p = OCEAN_CONFIG.ripplePixel;
    expect(p.fadeStart).toBeLessThan(p.fadeEnd);
    expect(p.fadeEnd).toBeLessThanOrEqual(0.5);
  });
});

import { describe, expect, it } from 'vitest';
import { EXPOSURE_CONFIG, SKY_CONFIG } from '../src/data/sky';
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../src/data/quality';
import {
  aerialDistanceScale,
  airMass,
  computeExposure,
  computeSkyLighting,
  extraterrestrialSun,
  luminance,
  miePhase,
  rayleighPhase,
  skyRadiance,
  sunDirection,
  sunTransmittance,
  type Rgb,
} from '../src/render/atmosphere-model';

const E = extraterrestrialSun();
const sun = sunDirection(SKY_CONFIG.sun.azimuth, SKY_CONFIG.sun.elevation);
/** 赤 / 青 の比。大きいほど赤い */
const redness = (c: Readonly<Rgb>): number => c[0] / c[2];

describe('大気散乱', () => {
  it('空気の厚さは天頂で 1、地平線で約 36、地平線より下は地平線と同じ', () => {
    expect(airMass(1)).toBeCloseTo(1, 2);
    expect(airMass(0)).toBeGreaterThan(30);
    expect(airMass(0)).toBeLessThan(40);
    expect(airMass(-0.5)).toBe(airMass(0));
    expect(airMass(0.5)).toBeCloseTo(2, 1);
  });

  it('位相関数は全立体角で積分すると 1', () => {
    for (const phase of [rayleighPhase, (c: number) => miePhase(c, 0.76)]) {
      // ∫ P dω = 2π ∫ P(cosθ) d(cosθ)
      let sum = 0;
      const n = 20000;
      for (let i = 0; i < n; i++) sum += phase(-1 + (2 * (i + 0.5)) / n) * (2 / n);
      expect(sum * 2 * Math.PI).toBeCloseTo(1, 2);
    }
  });

  it('太陽が地平線に近いほど届く光が赤くなる', () => {
    let prev = 0;
    for (const el of [90, 60, 32, 15, 5, 1]) {
      const t = sunTransmittance(sunDirection(0, el), 0);
      expect(redness(t)).toBeGreaterThan(prev);
      prev = redness(t);
    }
    // 真上でもわずかに黄色い（青が多く散乱される）、沈む直前は真っ赤
    expect(redness(sunTransmittance(sunDirection(0, 90), 0))).toBeGreaterThan(1);
    expect(redness(sunTransmittance(sunDirection(0, 1), 0))).toBeGreaterThan(10);
  });

  it('夕方の空（太陽の近くの地平線）は昼より赤い', () => {
    const glowAt = (el: number): Rgb => {
      const s = sunDirection(0, el);
      return skyRadiance({ x: 0, y: 0.02, z: -1 }, s, E, 0);
    };
    expect(redness(glowAt(3))).toBeGreaterThan(redness(glowAt(32)) * 1.5);
  });

  it('天頂は青く、地平線は白っぽく明るい', () => {
    const zenith = skyRadiance({ x: 0, y: 1, z: 0 }, sun, E, 0);
    // 太陽と反対の地平線
    const away = { x: -sun.x, y: 0, z: -sun.z };
    const len = Math.hypot(away.x, away.z);
    const horizon = skyRadiance({ x: away.x / len, y: 0, z: away.z / len }, sun, E, 0);
    expect(zenith[2]).toBeGreaterThan(zenith[1]);
    expect(zenith[1]).toBeGreaterThan(zenith[0]);
    expect(zenith[2] / zenith[0]).toBeGreaterThan(2.5);
    // 地平線は色の差が小さい（白い霞）
    const spread = (c: Readonly<Rgb>): number => Math.max(...c) / Math.min(...c);
    expect(spread(horizon)).toBeLessThan(1.4);
    expect(spread(horizon)).toBeLessThan(spread(zenith));
    expect(luminance(horizon)).toBeGreaterThan(luminance(zenith) * 2);
  });

  it('太陽の近くは Mie の前方散乱で明るい', () => {
    const near = skyRadiance(
      sunDirection(SKY_CONFIG.sun.azimuth, SKY_CONFIG.sun.elevation + 3),
      sun,
      E,
      0,
    );
    const far = skyRadiance(
      sunDirection(SKY_CONFIG.sun.azimuth + 180, SKY_CONFIG.sun.elevation + 3),
      sun,
      E,
      0,
    );
    expect(luminance(near)).toBeGreaterThan(luminance(far) * 3);
  });

  it('高いところほど空が暗く青い（空気が薄い）', () => {
    const up = { x: 0, y: 0.3, z: -0.95 };
    const low = skyRadiance(up, sun, E, 0);
    const high = skyRadiance(up, sun, E, 8000);
    expect(luminance(high)).toBeLessThan(luminance(low));
  });

  it('地上の太陽光は白に近い暖色（午後の光）', () => {
    const l = computeSkyLighting(sun);
    const [r, g, b] = l.sun;
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
    expect(b / r).toBeGreaterThan(0.75);
    // 空の光は青い
    expect(l.skyIrradiance[2]).toBeGreaterThan(l.skyIrradiance[0]);
    // 直射日光は空の光より強い
    expect(luminance(l.sun) * sun.y).toBeGreaterThan(luminance(l.skyIrradiance));
  });
});

describe('露出', () => {
  it('明るいほど露出は小さい', () => {
    expect(computeExposure(1, 0.1)).toBeLessThan(computeExposure(0.5, 0.05));
    expect(computeExposure(0.2, 0.1)).toBeLessThan(computeExposure(0.1, 0.1));
  });

  it('中間の明るさが key に合う', () => {
    const cfg = { key: 0.18, groundWeight: 0.5, minGround: 0, maxExposure: Infinity };
    const e = computeExposure(0.4, 0.1, cfg);
    expect(Math.sqrt(0.4 * 0.1) * e).toBeCloseTo(0.18, 5);
  });

  it('空がとても明るくても地面は minGround より暗くならない（上限の範囲で）', () => {
    const ground = 0.05;
    for (const sky of [0.1, 1, 10, 100]) {
      expect(computeExposure(sky, ground) * ground).toBeGreaterThanOrEqual(
        EXPOSURE_CONFIG.minGround - 1e-9,
      );
    }
  });

  it('露出は maxExposure（3）を超えない（4-2b）', () => {
    expect(EXPOSURE_CONFIG.maxExposure).toBe(3);
    for (const [sky, ground] of [
      [1e-4, 1e-4],
      [0.001, 0.02],
      [0.05, 0.001],
    ] as const) {
      expect(computeExposure(sky, ground)).toBeLessThanOrEqual(3);
    }
    for (const el of [5, 15, 32, 60, 85]) {
      expect(computeSkyLighting(sunDirection(40, el)).exposure).toBeLessThanOrEqual(3);
    }
  });

  it('今の太陽で、地面・空がトーンマッピングでつぶれない範囲に入る', () => {
    const l = computeSkyLighting(sun);
    const groundLum =
      (EXPOSURE_CONFIG.groundAlbedo * (luminance(l.sun) * sun.y + luminance(l.skyIrradiance))) /
      Math.PI;
    const g = groundLum * l.exposure;
    const horizon = luminance(l.horizon) * l.exposure;
    expect(g).toBeGreaterThanOrEqual(EXPOSURE_CONFIG.minGround - 1e-9);
    expect(g).toBeLessThan(0.6);
    // 地平線の空は地面より明るいが、白飛びしきらない
    expect(horizon).toBeGreaterThan(g);
    expect(horizon).toBeLessThan(2);
  });
});

describe('品質フラグ', () => {
  it('低: 影・ポストエフェクト・ブルーム・地形ディテールなし', () => {
    const p = QUALITY_PRESETS.low;
    expect([p.shadows, p.postEffects, p.bloom, p.terrainDetail]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('中: 影・ポストエフェクト・地形ディテールあり、ブルームなし', () => {
    const p = QUALITY_PRESETS.medium;
    expect([p.shadows, p.postEffects, p.bloom, p.terrainDetail]).toEqual([true, true, false, true]);
  });

  it('高: すべてあり', () => {
    const p = QUALITY_PRESETS.high;
    expect([p.shadows, p.postEffects, p.bloom, p.terrainDetail]).toEqual([true, true, true, true]);
  });

  it('上の段階ほど機能が減らない。ブルームはポストエフェクトがあるときだけ', () => {
    const flags = ['shadows', 'postEffects', 'bloom', 'terrainDetail'] as const;
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const prev = QUALITY_PRESETS[QUALITY_LEVELS[i - 1] ?? 'low'];
      const cur = QUALITY_PRESETS[QUALITY_LEVELS[i] ?? 'low'];
      for (const f of flags) if (prev[f]) expect(cur[f]).toBe(true);
      expect(cur.shadowMapSize).toBeGreaterThanOrEqual(prev.shadowMapSize);
    }
    for (const level of QUALITY_LEVELS) {
      const p = QUALITY_PRESETS[level];
      if (p.bloom) expect(p.postEffects).toBe(true);
      if (p.shadows) expect(p.shadowMapSize).toBeGreaterThan(0);
    }
  });
});

describe('空気遠近の高さによる減衰（4-2b）', () => {
  // 4-2b の基準（地表の距離 3 倍）。4-7 で高度 500m 以下だけ 0.8 倍にした
  const ground = SKY_CONFIG.aerial.distanceScale;
  it('地表では距離 3 倍の 0.8 倍、500m までは 4-2b の 0.8 倍、700m から上は 4-2b のまま（4-7）', () => {
    expect(aerialDistanceScale(0)).toBeCloseTo(ground * 0.8, 10);
    expect(aerialDistanceScale(500)).toBeCloseTo(ground * Math.exp(-500 / 1960) * 0.8, 10);
    expect(aerialDistanceScale(700)).toBeCloseTo(ground * Math.exp(-700 / 1960), 10);
    expect(aerialDistanceScale(600)).toBeGreaterThan(aerialDistanceScale(500));
  });
  it('カメラ高度 1000m で地上の約 60%、2000m で約 35%', () => {
    expect(aerialDistanceScale(1000) / ground).toBeCloseTo(0.6, 1);
    expect(aerialDistanceScale(2000) / ground).toBeGreaterThan(0.32);
    expect(aerialDistanceScale(2000) / ground).toBeLessThan(0.38);
  });
});

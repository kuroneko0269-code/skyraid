// 夕焼け（7-5b）: 低い太陽の重み、大気散乱の夕焼けの項（地平線の赤橙・天頂の紫青・赤橙の直射光）、
// 夕方の露出 −0.3EV、昼・快晴は変えないこと
import { describe, expect, it } from 'vitest';
import {
  lowSunAt,
  lowSunExposureAt,
  lowSunWeight,
  nightWeight,
  sunWeight,
  timeOfDayHour,
} from '../src/core/weather-state';
import { EXPOSURE_CONFIG, LOW_SUN_CONFIG, SKY_CONFIG } from '../src/data/sky';
import { NIGHT_CONFIG, OVERCAST_CONFIG, TIME_OF_DAY_CONFIG } from '../src/data/weather';
import {
  extraterrestrialSun,
  skyRadiance,
  sunDirection,
  sunTransmittance,
} from '../src/render/atmosphere-model';
import { computeWeatherLighting } from '../src/render/atmosphere-weather';

function lightingAt(elevation: number, low: number | undefined, bias = 0) {
  const night = nightWeight(elevation);
  const m = NIGHT_CONFIG.moon;
  return computeWeatherLighting(
    {
      sun: sunDirection(SKY_CONFIG.sun.azimuth, elevation),
      sunE: SKY_CONFIG.sun.irradiance * sunWeight(elevation),
      moon: sunDirection(m.azimuth, m.elevation),
      moonE: NIGHT_CONFIG.moonIrradiance * night,
      overcast: 0,
      night,
      exposureBias: bias,
      lowSun: low,
    },
    NIGHT_CONFIG.moonTint,
    OVERCAST_CONFIG,
    NIGHT_CONFIG,
  );
}

const EVENING = TIME_OF_DAY_CONFIG.evening.elevation;
const SUN_EVENING = sunDirection(0, EVENING);

/** 太陽の方位（0）から azimuth 度回した、仰角 elevation 度の空 */
function skyAt(azimuth: number, elevation: number, low: number): number[] {
  return skyRadiance(
    sunDirection(azimuth, elevation),
    SUN_EVENING,
    extraterrestrialSun(),
    0,
    undefined,
    low,
  );
}

describe('夕焼け（7-5b）', () => {
  it('低い太陽の重み: 昼 32° と夜は 0、夕方 5°・早朝 6° は 1', () => {
    expect(lowSunWeight(SKY_CONFIG.sun.elevation)).toBe(0);
    expect(lowSunWeight(-10)).toBe(0);
    expect(lowSunWeight(EVENING)).toBe(1);
    expect(lowSunWeight(TIME_OF_DAY_CONFIG.dawn.elevation)).toBe(1);
    expect(lowSunAt(timeOfDayHour('evening'))).toBeCloseTo(1, 9);
    expect(lowSunAt(timeOfDayHour('day'))).toBe(0);
  });

  it('昼・快晴の光と露出は重み 0 で 7-5 と同じ（太陽の色・空の光・露出）', () => {
    const before = lightingAt(32, undefined);
    const after = lightingAt(32, lowSunWeight(32));
    expect(after.sun).toEqual(before.sun);
    expect(after.skyIrradiance).toEqual(before.skyIrradiance);
    expect(after.exposure).toBe(before.exposure);
  });

  it('夕方の直射光は赤橙（R > G > B、G は R の半分以下）', () => {
    const t = sunTransmittance(SUN_EVENING, 0, undefined, 1);
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
    expect(t[1] / t[0]).toBeLessThan(0.5);
  });

  it('地平線（太陽の方・反対側とも）は赤橙、天頂は紫がかった青（B 最大・R > G × 0.8）', () => {
    for (const az of [0, 180]) {
      const h = skyAt(az, 1, 1);
      expect(h[0]).toBeGreaterThan((h[1] ?? 0) * 1.5);
      expect(h[1]).toBeGreaterThan(h[2] ?? 0);
    }
    const z = skyAt(0, 89, 1);
    expect(z[2]).toBeGreaterThan(z[0] ?? 0);
    expect(z[2]).toBeGreaterThan(z[1] ?? 0);
    expect(z[0]).toBeGreaterThan((z[1] ?? 0) * 0.8);
  });

  it('Mie を強め、太陽のまわりの光芒が明るくなる', () => {
    const near = (low: number): number => skyAt(0, EVENING + 3, low)[0] ?? 0;
    const far = (low: number): number => skyAt(90, EVENING + 3, low)[0] ?? 0;
    expect(near(1) / far(1)).toBeGreaterThan(near(0) / far(0));
  });

  it('夕方の露出は −0.3EV（上限 3.0 以下）、朝は補正なし', () => {
    const evening = timeOfDayHour('evening');
    expect(lowSunExposureAt(evening)).toBeCloseTo(LOW_SUN_CONFIG.duskExposureEv, 9);
    expect(lowSunExposureAt(timeOfDayHour('dawn'))).toBe(0);
    expect(lowSunExposureAt(timeOfDayHour('day'))).toBeCloseTo(0, 9);
    const base = lightingAt(EVENING, 1);
    const dim = lightingAt(EVENING, 1, LOW_SUN_CONFIG.duskExposureEv);
    expect(dim.exposure / base.exposure).toBeCloseTo(Math.pow(2, -0.3), 6);
    expect(base.exposure).toBeLessThanOrEqual(EXPOSURE_CONFIG.maxExposure);
  });

  it('夕方の環境光（空の光）は直射光より青い（暖色の直射 + 青い環境光）', () => {
    const l = lightingAt(EVENING, 1);
    const ratio = (c: readonly number[]): number => (c[2] ?? 0) / (c[0] ?? 1);
    expect(ratio(l.skyIrradiance)).toBeGreaterThan(ratio(l.sun) * 5);
  });
});

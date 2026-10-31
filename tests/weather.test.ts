// 天候と時間帯（7-5）: プリセットの値、太陽の仰角と露出（夜の上限）、遷移の補間と時間の進行。
// モードごとの割当・welcome・HUD・音は weather-modes.test.ts
import { describe, expect, it } from 'vitest';
import {
  createWeatherParams,
  hourForElevation,
  lerpWeather,
  nightWeight,
  presetParams,
  sunAzimuthAt,
  sunElevationAt,
  sunWeight,
  timeOfDayHour,
  WeatherDirector,
} from '../src/core/weather-state';
import { OCEAN_CONFIG } from '../src/data/ocean';
import { QUALITY_PRESETS } from '../src/data/quality';
import { EXPOSURE_CONFIG, SKY_CONFIG } from '../src/data/sky';
import {
  DEFAULT_WEATHER_ID,
  findWeather,
  NIGHT_CONFIG,
  OVERCAST_CONFIG,
  SKY_KIND_CONFIG,
  STRONG_WIND,
  TIME_OF_DAY_CONFIG,
  WEATHER_PRESETS,
  WEATHER_TIME,
  weatherLabel,
} from '../src/data/weather';
import { sunDirection } from '../src/render/atmosphere-model';
import { computeWeatherLighting, weatherExposure } from '../src/render/atmosphere-weather';

/** 仰角（度）の太陽・月と天候から光を計算する（Atmosphere.compute と同じ組み立て） */
function lightingAt(elevation: number, overcast = 0, bias = 0) {
  const night = nightWeight(elevation);
  const m = NIGHT_CONFIG.moon;
  return computeWeatherLighting(
    {
      sun: sunDirection(SKY_CONFIG.sun.azimuth, elevation),
      sunE: SKY_CONFIG.sun.irradiance * sunWeight(elevation),
      moon: sunDirection(m.azimuth, m.elevation),
      moonE: NIGHT_CONFIG.moonIrradiance * night,
      overcast,
      night,
      exposureBias: bias,
    },
    NIGHT_CONFIG.moonTint,
    OVERCAST_CONFIG,
    NIGHT_CONFIG,
  );
}

describe('天候: プリセットの値', () => {
  it('プリセットは 8 種、id は重複なし、先頭は昼・快晴・弱風', () => {
    expect(WEATHER_PRESETS).toHaveLength(8);
    expect(new Set(WEATHER_PRESETS.map((p) => p.id)).size).toBe(8);
    expect(WEATHER_PRESETS[0]?.id).toBe(DEFAULT_WEATHER_ID);
    expect(weatherLabel('day-clear')).toBe('昼・快晴・弱風');
    expect(weatherLabel('evening-clear')).toBe('夕方・快晴・弱風');
    expect(weatherLabel('night-rain')).toBe('夜・雨・強風');
    // 4 つの時間帯・4 つの天候・2 つの風がすべて使われている
    expect(new Set(WEATHER_PRESETS.map((p) => p.time)).size).toBe(4);
    expect(new Set(WEATHER_PRESETS.map((p) => p.sky)).size).toBe(4);
    expect(new Set(WEATHER_PRESETS.map((p) => p.wind)).size).toBe(2);
  });

  it('時間帯の仰角: 早朝 6°・昼 32°（4-1 と同じ）・夕方 5°・夜 −10°（7-5b）。昼の方位は 4-1 の 40°', () => {
    expect(TIME_OF_DAY_CONFIG.dawn.elevation).toBe(6);
    expect(TIME_OF_DAY_CONFIG.day.elevation).toBe(SKY_CONFIG.sun.elevation);
    expect(TIME_OF_DAY_CONFIG.evening.elevation).toBe(5);
    expect(TIME_OF_DAY_CONFIG.night.elevation).toBe(-10);
    for (const t of ['dawn', 'day', 'evening', 'night'] as const)
      expect(sunElevationAt(timeOfDayHour(t))).toBeCloseTo(TIME_OF_DAY_CONFIG[t].elevation, 6);
    expect(sunAzimuthAt(timeOfDayHour('day'))).toBeCloseTo(SKY_CONFIG.sun.azimuth, 6);
    // 早朝は午前、夕方・夜は午後の側
    expect(timeOfDayHour('dawn')).toBeLessThan(12);
    expect(timeOfDayHour('evening')).toBeGreaterThan(12);
    expect(timeOfDayHour('night')).toBeGreaterThan(18);
    expect(hourForElevation(0, 'morning')).toBeCloseTo(6, 6);
  });

  it('曇り: 被覆 0.85・光が拡散（直射が弱く空の光が増える）。霧: 視程 1.5km・空気遠近 ×2.5', () => {
    const overcast = presetParams('day-overcast');
    expect(overcast.coverage).toBe(0.85);
    const fog = presetParams('dawn-fog');
    expect(SKY_KIND_CONFIG.fog.visibility).toBe(1500);
    expect(fog.fog).toBeCloseTo(3.0 / 1500, 9);
    expect(fog.haze).toBe(2.5);
    const clear = lightingAt(32);
    const grey = lightingAt(32, overcast.overcast);
    const lum = (c: readonly number[]): number =>
      0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    expect(lum(grey.sun)).toBeLessThan(lum(clear.sun) * 0.4);
    expect(lum(grey.skyIrradiance)).toBeGreaterThan(lum(clear.skyIrradiance));
  });

  it('雨: 暗い雲・雨 1・視認性が悪い。昼・快晴は 4-1 / 4-2 の値のまま（霧なし・空気遠近 1・被覆 0.45・風 0）', () => {
    const rain = presetParams('night-rain');
    expect(rain.rain).toBe(1);
    expect(rain.cloudDark).toBeGreaterThan(0.3);
    expect(rain.lowVisibility).toBe(1);
    expect(rain.wind).toBe(1);
    const day = presetParams('day-clear');
    expect(day).toMatchObject({ fog: 0, haze: 1, coverage: 0.45, overcast: 0, rain: 0, wind: 0 });
    expect(day.exposureBias).toBe(0);
  });

  it('強風の波は振幅の合計 1.5m 以内・鋭さの合計 1 未満（4-2 の上限）', () => {
    const waves = OCEAN_CONFIG.waves;
    const amp = waves.reduce(
      (s, w, i) => s + w.amplitude * (i < 2 ? 1 : STRONG_WIND.waveAmplitude),
      0,
    );
    const steep = waves.reduce(
      (s, w, i) => s + w.steepness * (i < 2 ? 1 : STRONG_WIND.waveSteepness),
      0,
    );
    expect(amp).toBeLessThanOrEqual(OCEAN_CONFIG.maxAmplitude);
    expect(steep).toBeLessThan(1);
  });

  it('画質: 星は「低」1000・「高」4000、雨は「低」が全画面の筋 1 枚', () => {
    expect(QUALITY_PRESETS.low.starCount).toBe(1000);
    expect(QUALITY_PRESETS.high.starCount).toBe(4000);
    expect(QUALITY_PRESETS.low.rainMode).toBe('sheet');
    expect(QUALITY_PRESETS.medium.rainMode).toBe('streaks');
    expect(QUALITY_PRESETS.high.rainMode).toBe('streaks');
  });

  it('知らない id は初期値（昼・快晴）', () => {
    expect(findWeather('nope').id).toBe(DEFAULT_WEATHER_ID);
  });
});

describe('天候: 太陽の仰角と露出', () => {
  it('昼・快晴の光と露出は 4-1 のまま（約 2.2）', () => {
    const l = lightingAt(32);
    expect(l.exposure).toBeGreaterThan(2.0);
    expect(l.exposure).toBeLessThan(2.4);
    expect(l.moonKey).toBe(false);
  });

  it('どの仰角でも露出は上限 3.0 以下、夜（−10° 以下）は固定露出', () => {
    for (let el = -20; el <= 60; el += 1) {
      const e = lightingAt(el).exposure;
      expect(e).toBeLessThanOrEqual(EXPOSURE_CONFIG.maxExposure + 1e-9);
      expect(e).toBeGreaterThan(0.5);
    }
    expect(lightingAt(-10).exposure).toBeCloseTo(NIGHT_CONFIG.exposure, 6);
    expect(lightingAt(-30).exposure).toBeCloseTo(NIGHT_CONFIG.exposure, 6);
    expect(NIGHT_CONFIG.exposure).toBeLessThan(EXPOSURE_CONFIG.maxExposure);
  });

  it('夕方の自動露出は上限で止まる（4-1 の「8 まで上がる」問題）', () => {
    expect(weatherExposure(8, 0, 0, NIGHT_CONFIG.exposure)).toBe(EXPOSURE_CONFIG.maxExposure);
    // 夜らしさで夜の固定露出へ混ぜる・補正（EV）を掛ける
    expect(weatherExposure(8, 1, 0, 2)).toBe(2);
    expect(weatherExposure(2, 0.5, 0, 1)).toBeCloseTo(1.5, 9);
    expect(weatherExposure(2, 0, -1, 1)).toBeCloseTo(1, 9);
  });

  it('夜は月が直射光（青白く弱い）、太陽の明るさは 0、空は太陽が地平線の下でも暗い', () => {
    const night = lightingAt(-10);
    const day = lightingAt(32);
    expect(night.moonKey).toBe(true);
    expect(sunWeight(-10)).toBe(0);
    expect(nightWeight(-10)).toBe(1);
    expect(night.sun[2]).toBeGreaterThan(night.sun[0]);
    const lum = (c: readonly number[]): number =>
      0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
    expect(lum(night.sun)).toBeLessThan(lum(day.sun) * 0.2);
    expect(lum(night.skyIrradiance)).toBeLessThan(lum(day.skyIrradiance) * 0.2);
  });

  it('時間が流れて地平線をまたいでも、光は途切れず（直射の向きの入れ替えは暗いところで）', () => {
    let prev = lightingAt(5);
    for (let el = 4.5; el >= -12; el -= 0.5) {
      const l = lightingAt(el);
      const lum = (c: readonly number[]): number =>
        0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
      // 0.5° ごとの空の光の変化は前の値 + 夜の空の明るさの半分まで
      const jump = Math.abs(lum(l.skyIrradiance) - lum(prev.skyIrradiance));
      expect(jump).toBeLessThan(lum(prev.skyIrradiance) * 0.5 + 0.02);
      if (l.moonKey !== prev.moonKey)
        expect(lum(l.sun)).toBeLessThan(lum(lightingAt(32).sun) * 0.1);
      prev = l;
    }
  });
});

describe('天候: 遷移の補間と時間の進行', () => {
  it('3 秒で補間（途中は間の値、3 秒で到着）。時刻は 24 時間の輪の近い方を回る', () => {
    const d = new WeatherDirector('day-clear');
    d.set('dawn-fog');
    expect(d.transitioning).toBe(true);
    d.update(1.5);
    const mid = d.current;
    const from = presetParams('day-clear');
    const to = presetParams('dawn-fog');
    expect(mid.fog).toBeGreaterThan(0);
    expect(mid.fog).toBeLessThan(to.fog);
    expect(mid.haze).toBeCloseTo((from.haze + to.haze) / 2, 6);
    d.update(1.5);
    expect(d.transitioning).toBe(false);
    expect(d.current).toEqual(to);
    expect(WEATHER_TIME.transitionSeconds).toBe(3);
  });

  it('補間の時刻: 23 時 → 1 時は 0 時を通る', () => {
    const a = { ...createWeatherParams(), hour: 23 };
    const b = { ...createWeatherParams(), hour: 1 };
    const out = createWeatherParams();
    expect(lerpWeather(a, b, 0.5, out).hour).toBeCloseTo(0, 6);
    expect(lerpWeather(a, b, 0.25, out).hour).toBeCloseTo(23.5, 6);
  });

  it('時間が流れる: 1 ゲーム日 = 10 実分。補間中も補間先の時刻が進む', () => {
    const d = new WeatherDirector('day-clear');
    d.setTimeFlow(true);
    const h0 = d.current.hour;
    d.update(60);
    expect(d.current.hour).toBeCloseTo((h0 + 2.4) % 24, 6);
    d.set('evening-clear');
    for (let i = 0; i < 30; i++) d.update(0.1);
    expect(d.current.hour).toBeCloseTo(timeOfDayHour('evening') + (3 / 600) * 24, 6);
    // 止めると時刻は動かない
    d.setTimeFlow(false);
    const h = d.current.hour;
    expect(d.update(5)).toBe(false);
    expect(d.current.hour).toBe(h);
  });

  it('同じプリセットを選び直しても補間しない。instant はすぐ', () => {
    const d = new WeatherDirector('day-clear');
    d.update(0);
    d.set('day-clear');
    expect(d.transitioning).toBe(false);
    d.set('night-rain', true);
    expect(d.transitioning).toBe(false);
    expect(d.current).toEqual(presetParams('night-rain'));
  });
});

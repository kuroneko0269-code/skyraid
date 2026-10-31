// 天候の描画への適用（7-5）: WeatherDirector（core）の補間した値を、大気（太陽・月・曇天・霧・露出）・雲（被覆・暗さ・
// 風）・海（風波・雨の波紋）・木（風の揺れ）・星・雨に入れる。重い計算（大気の光の積分・環境マップの焼き直し）は
// 値が変わったときだけ、環境マップは間引いて行う
import { Vector2, Vector4, type PerspectiveCamera, type Scene } from 'three';
import {
  createWeatherParams,
  lowVisibilityOf,
  nightWeight,
  sunAzimuthAt,
  sunElevationAt,
  sunTintAt,
  WeatherDirector,
  type WeatherParams,
} from '../../core/weather-state';
import { OCEAN_CONFIG } from '../../data/ocean';
import type { QualityPreset } from '../../data/quality';
import { DEFAULT_WEATHER_ID, RAIN_CONFIG, STRONG_WIND } from '../../data/weather';
import { WIND_CONFIG } from '../../data/wind';
import type { Atmosphere } from '../atmosphere';
import type { CloudField } from '../cloud-field';
import type { Clouds } from '../clouds';
import { buildGerstnerWaves } from '../gerstner';
import type { Ocean } from '../ocean';
import type { Vegetation } from '../vegetation';
import { Rain } from './rain';
import { Stars } from './stars';

export interface WeatherViewParts {
  readonly scene: Scene;
  readonly atmosphere: Atmosphere;
  readonly cloudField: CloudField;
  readonly clouds: Clouds;
  readonly ocean: Ocean;
  readonly vegetation: Vegetation;
}

/** 環境マップを焼き直す最短の間隔（秒。補間中・時間の進行中） */
const BAKE_INTERVAL = 1;
const WAVES = buildGerstnerWaves();
const MAX_STARS = 4000;
const MAX_DROPS = 6000;

export class WeatherView {
  readonly director = new WeatherDirector(DEFAULT_WEATHER_ID);
  readonly stars = new Stars(MAX_STARS);
  readonly rain = new Rain(MAX_DROPS);
  /** 環境マップを焼き直す（scene.ts の createWorldScene が入れる） */
  onBake: (() => void) | null = null;
  /** 描画フレームごとに天候を更新する前に呼ぶ（画面・HUD の配線。ui/weather-link.ts） */
  onFrame: (() => void) | null = null;
  private readonly applied: WeatherParams = createWeatherParams();
  private readonly tint: [number, number, number] = [1, 1, 1];
  private sinceBake = 0;
  private bakePending = false;
  private time = 0;
  private lastWorldTime: number | null = null;

  constructor(private readonly p: WeatherViewParts) {
    p.scene.add(this.stars.mesh, this.rain.streaks, this.rain.sheet);
    this.apply(this.director.current);
  }

  /** プリセットを変える（instant なら補間なし） */
  set(id: string, instant = false): void {
    this.director.set(id, instant);
  }

  setTimeFlow(on: boolean): void {
    this.director.setTimeFlow(on);
  }

  get params(): Readonly<WeatherParams> {
    return this.director.current;
  }

  /** 視認性の悪さ（0〜1。霧・雨・夜）。HUD のマーカーの距離に使う */
  get lowVisibility(): number {
    return lowVisibilityOf(this.director.current);
  }

  /** 夜らしさ（0〜1） */
  get night(): number {
    return nightWeight(sunElevationAt(this.director.current.hour));
  }

  applyQuality(preset: QualityPreset, pixelRatio: number): void {
    this.stars.setQuality(preset.starCount, preset.drawDistance, pixelRatio);
    this.rain.setQuality(preset.rainMode, preset.rainDrops);
  }

  /** 描画フレームごと。time はポーズで止まる世界の時間（秒） */
  update(camera: PerspectiveCamera, time: number): void {
    const dt =
      this.lastWorldTime === null ? 0 : Math.min(0.1, Math.max(0, time - this.lastWorldTime));
    this.lastWorldTime = time;
    this.time += dt;
    this.onFrame?.();
    const d = this.director;
    if (d.update(dt)) this.apply(d.current);
    const w = d.current;
    // 環境マップ: 変わり続けている間は間引き、止まったら最後の状態で 1 回
    this.sinceBake += dt;
    const moving = d.transitioning || d.timeFlow;
    if (this.bakePending && (!moving || this.sinceBake >= BAKE_INTERVAL)) {
      this.bakePending = false;
      this.sinceBake = 0;
      this.onBake?.();
    }
    // 星: 夜 × 晴れ（曇天・霧・雨で消える）
    const clear = (1 - w.overcast) * Math.exp(-w.fog * 3000) * (1 - w.rain);
    this.stars.update(this.night * clear, this.time);
    const a = (WIND_CONFIG.direction * Math.PI) / 180;
    const drift = RAIN_CONFIG.windDrift * (0.4 + 0.6 * w.wind);
    this.rain.update(camera, w.rain, Math.cos(a) * drift, Math.sin(a) * drift, dt, this.time);
  }

  /** 天候の値を描画に入れる（値が変わったときだけ） */
  private apply(w: Readonly<WeatherParams>): void {
    const p = this.p;
    const prev = this.applied;
    p.atmosphere.setWeather({
      sunAzimuth: sunAzimuthAt(w.hour),
      sunElevation: sunElevationAt(w.hour),
      overcast: w.overcast,
      fog: w.fog,
      haze: w.haze,
      exposureBias: w.exposureBias,
      sunTint: sunTintAt(w.hour, this.tint),
    });
    p.cloudField.uniforms.uCloudCoverage.value = w.coverage;
    p.clouds.setDarkness(w.cloudDark);
    const s = STRONG_WIND;
    const wind = w.wind;
    p.cloudField.speedScale = 1 + (s.cloudSpeed - 1) * wind;
    p.vegetation.setSway(1 + (s.treeSway - 1) * wind);
    p.vegetation.swaySpeed = 1 + (s.treeSpeed - 1) * wind;
    if (wind !== prev.wind) this.applyOceanWind(wind);
    const u = p.ocean.sharedUniforms;
    if (u.uRain) u.uRain.value = w.rain;
    // 雨の色: 空の光で照らした水の筋（直射光は弱く効く）
    const l = p.atmosphere.lighting;
    const sky = l.skyIrradiance;
    const sun = l.sun;
    const k = 0.55 / Math.PI;
    this.rain.setColor(
      (sky[0] + sun[0] * 0.3) * k,
      (sky[1] + sun[1] * 0.3) * k,
      (sky[2] + sun[2] * 0.3) * k,
    );
    Object.assign(prev, w);
    this.bakePending = true;
  }

  /** 風波（3 本目から）の振幅・鋭さと、さざ波の傾きを風に合わせる（うねりは変えない） */
  private applyOceanWind(wind: number): void {
    const s = STRONG_WIND;
    const amp = 1 + (s.waveAmplitude - 1) * wind;
    const steep = 1 + (s.waveSteepness - 1) * wind;
    const ripple = 1 + (s.rippleSlope - 1) * wind;
    const u = this.p.ocean.detailedMesh.material.uniforms;
    const wa = u.uWaves?.value as Vector4[] | undefined;
    const wb = u.uWaveB?.value as Vector2[] | undefined;
    WAVES.forEach((wave, i) => {
      const swell = i < 2;
      const a = wa?.[i];
      const b = wb?.[i];
      if (a) a.w = wave.amplitude * (swell ? 1 : amp);
      if (b) b.y = (wave.steepness * (swell ? 1 : steep)) / wave.k;
    });
    // さざ波の層は両方の海のマテリアルで同じ配列
    const layers = u.uLayers?.value as Vector4[] | undefined;
    OCEAN_CONFIG.normalLayers.forEach((l, i) => {
      const v = layers?.[i];
      if (v) v.w = l.slope * ripple;
    });
  }
}

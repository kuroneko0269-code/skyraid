// 物理ベースの空（4-1）: 大気散乱（Rayleigh + Mie）のスカイドーム、太陽の円盤と光芒、空気遠近の霧。
// 計算は atmosphere-model.ts（CPU）と atmosphere-glsl.ts（GPU）で同じ式
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, Vector4 } from 'three';
import { LOW_SUN_CONFIG, SKY_CONFIG } from '../data/sky';
import { NIGHT_CONFIG, OVERCAST_CONFIG } from '../data/weather';
import { nightWeight, sunWeight } from '../core/weather-state';
import type { Vec3 } from '../flight/math';
import { AtmosphereFog } from './atmosphere-fog';
import { ATMOSPHERE_GLSL, ATMO_WEATHER_UNIFORMS, installAtmosphereChunks } from './atmosphere-glsl';
import { extraterrestrialSun, sunDirection, sunTransmittance, type Rgb } from './atmosphere-model';
import { computeWeatherLighting, moonLight, type WeatherLighting } from './atmosphere-weather';

export { sunDirection };

const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSun;
  uniform float uSunE;
  uniform float uDiscCos;
  uniform float uDiscEdgeCos;
  uniform float uDiscRadiance;
  uniform vec4 uGlow;
  // 月（7-5）: x = 円盤の縁の cos、y = 縁をぼかし終える cos、z = 円盤の明るさ（月の放射照度に対する倍率）、
  // w = 周囲の光の強さ。uMoonHalo = 周囲の光の鋭さ
  uniform vec4 uMoonDisc;
  uniform float uMoonHalo;
  varying vec3 vDir;
  ${ATMOSPHERE_GLSL}
  #include <common>
  void main() {
    vec3 dir = normalize(vDir);
    float h = cameraPosition.y;
    // 地平線より下は描画距離の外の海面（atmoBackground）
    vec3 color = atmoBackground(dir, uSun, uSunE, h);
    // 曇天・霧では太陽・月の円盤が隠れる（7-5）
    float visible = (1.0 - 0.97 * atmoOvercastAt(h)) * exp(-uAtmoWeather.y * 2500.0) * step(0.0, dir.y);
    // 太陽の円盤とまぶしさ（光芒）。地上に届く太陽の色で、地平線より下には描かない
    vec3 sunColor = ATMO_SUN_COLOR * uSunE * atmoSunTransmittance(uSun, h);
    float c = max(dot(dir, uSun), 0.0);
    float disc = smoothstep(uDiscEdgeCos, uDiscCos, c);
    color += visible * sunColor * (disc * uDiscRadiance + uGlow.x * pow(c, uGlow.y) + uGlow.z * pow(c, uGlow.w));
    // 月の円盤（海の模様の濃淡と周縁減光）と周囲の光
    if (uAtmoMoon.w > 0.0) {
      vec3 mu = uAtmoMoon.xyz;
      vec3 moonColor = ATMO_SUN_COLOR * ATMO_MOON_TINT * uAtmoMoon.w * atmoSunTransmittance(mu, h);
      float cm = max(dot(dir, mu), 0.0);
      float md = smoothstep(uMoonDisc.y, uMoonDisc.x, cm);
      if (md > 0.0) {
        vec3 t1 = normalize(cross(mu, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
        vec3 t2 = cross(t1, mu);
        vec2 uv = vec2(dot(dir, t1), dot(dir, t2)) / sqrt(max(1.0 - uMoonDisc.x * uMoonDisc.x, 1e-8));
        float maria = 0.78 + 0.12 * sin(uv.x * 5.3 + 1.1) * sin(uv.y * 4.1 - 0.6)
          + 0.08 * sin(uv.x * 11.0 - uv.y * 9.0 + 2.0);
        float limb = sqrt(max(1.0 - dot(uv, uv), 0.0));
        md *= maria * (0.6 + 0.4 * limb);
      }
      color += visible * moonColor * (md * uMoonDisc.z + uMoonDisc.w * pow(cm, uMoonHalo));
    }
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export { AtmosphereFog };

export type AtmosphereListener = (atmosphere: Atmosphere) => void;

/** 大気に入れる天候（7-5）。太陽の向きと、曇天・霧・空気遠近・露出の補正 */
export interface AtmosphereWeather {
  sunAzimuth: number;
  sunElevation: number;
  overcast: number;
  /** 霧の消散係数（1/m、海面） */
  fog: number;
  /** 空気遠近の倍率（1 = 4-1 のまま） */
  haze: number;
  exposureBias: number;
  /** 低い太陽の重み（0〜1。7-5b。省略で 0） */
  lowSun?: number;
}

/**
 * 空のドーム・空気遠近の霧・太陽と月の向きと、そこから求めた光（WeatherLighting）をまとめる。
 * 太陽・天候を変える（7-5）ときは setSun / setWeather を呼ぶと、購読者（ライト・海・雲・露出）に通知する
 */
export class Atmosphere {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  readonly fog = new AtmosphereFog();
  /**
   * 直射光の向き（単位ベクトル、光源へ向かう向き）。昼は太陽、夜は月（7-5）。
   * 平行光源・影・海の照り返し・雲の光に使う
   */
  readonly sun: Vec3 = { x: 0, y: 1, z: 0 };
  /** 太陽そのものの向きと明るさ（夜は 0）。空のシェーダーに渡す */
  readonly skySun: Vec3 = { x: 0, y: 1, z: 0 };
  skySunE: number = SKY_CONFIG.sun.irradiance;
  /** 夜らしさ（0〜1） */
  night = 0;
  private current: WeatherLighting;
  private readonly weather: AtmosphereWeather = {
    sunAzimuth: SKY_CONFIG.sun.azimuth,
    sunElevation: SKY_CONFIG.sun.elevation,
    overcast: 0,
    fog: 0,
    haze: 1,
    exposureBias: 0,
  };
  /** 低い太陽の重み（0〜1。7-5b） */
  lowSun = 0;
  private readonly moon: Vec3;
  private readonly listeners: AtmosphereListener[] = [];

  constructor() {
    installAtmosphereChunks();
    const cfg = SKY_CONFIG;
    const moonCfg = NIGHT_CONFIG.moonDisc;
    const material = new ShaderMaterial({
      uniforms: {
        uSun: { value: new Vector3(0, 1, 0) },
        uSunE: { value: cfg.sun.irradiance },
        uDiscCos: { value: Math.cos(cfg.sun.discRadius * DEG) },
        // 円盤の縁を少しぼかす
        uDiscEdgeCos: { value: Math.cos(cfg.sun.discRadius * 1.15 * DEG) },
        uDiscRadiance: { value: cfg.sun.discRadiance },
        uGlow: { value: new Vector4() },
        uMoonDisc: {
          value: new Vector4(
            Math.cos(moonCfg.radius * DEG),
            Math.cos(moonCfg.radius * 1.12 * DEG),
            moonCfg.radiance,
            moonCfg.haloStrength,
          ),
        },
        uMoonHalo: { value: moonCfg.haloExponent },
        ...ATMO_WEATHER_UNIFORMS,
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(
      new SphereGeometry(cfg.radius, cfg.domeSegments.width, cfg.domeSegments.height),
      material,
    );
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    const m = NIGHT_CONFIG.moon;
    this.moon = sunDirection(m.azimuth, m.elevation);
    this.current = this.compute();
    this.apply();
    this.setGlow(true);
  }

  /** 太陽の向き（方位・仰角、度）を変えて、光と露出を計算し直す（天候はそのまま） */
  setSun(azimuthDeg: number, elevationDeg: number): void {
    this.weather.sunAzimuth = azimuthDeg;
    this.weather.sunElevation = elevationDeg;
    this.current = this.compute();
    this.apply();
  }

  /** 天候（太陽・曇天・霧・空気遠近・露出の補正）を変えて、光と露出を計算し直す（7-5） */
  setWeather(w: Readonly<AtmosphereWeather>): void {
    Object.assign(this.weather, w);
    this.current = this.compute();
    this.apply();
  }

  /** 今の天候から太陽・月の明るさと光を求める */
  private compute(): WeatherLighting {
    const w = this.weather;
    const d = sunDirection(w.sunAzimuth, w.sunElevation);
    Object.assign(this.skySun, d);
    this.skySunE = SKY_CONFIG.sun.irradiance * sunWeight(w.sunElevation);
    this.night = nightWeight(w.sunElevation);
    const moonE = NIGHT_CONFIG.moonIrradiance * this.night;
    this.lowSun = w.lowSun ?? 0;
    const l = computeWeatherLighting(
      {
        sun: d,
        sunE: this.skySunE,
        moon: this.moon,
        moonE,
        overcast: w.overcast,
        night: this.night,
        exposureBias: w.exposureBias,
        lowSun: this.lowSun,
      },
      NIGHT_CONFIG.moonTint,
      OVERCAST_CONFIG,
      NIGHT_CONFIG,
    );
    Object.assign(this.sun, l.keyDir);
    const sw = ATMO_WEATHER_UNIFORMS;
    sw.uAtmoWeather.value.x = w.haze - 1;
    sw.uAtmoWeather.value.y = w.fog;
    sw.uAtmoWeather.value.z = Math.min(1, Math.max(0, w.overcast));
    const mv = sw.uAtmoMoon.value;
    mv.x = this.moon.x;
    mv.y = this.moon.y;
    mv.z = this.moon.z;
    mv.w = moonE;
    sw.uAtmoLowSun.value.x = this.lowSun;
    const g = sw.uAtmoGrey.value;
    g.x = l.overcastZenith[0];
    g.y = l.overcastZenith[1];
    g.z = l.overcastZenith[2];
    return l;
  }

  /** 空のドーム・霧の uniform を書き換えて購読者に知らせる */
  private apply(): void {
    const d = this.skySun;
    // 太陽が地平線の下でも向きが残るよう、明るさはごく小さい値で止める
    const e = Math.max(this.skySunE, 1e-4);
    const u = this.mesh.material.uniforms;
    if (u.uSun) (u.uSun.value as Vector3).set(d.x, d.y, d.z);
    if (u.uSunE) u.uSunE.value = e;
    this.fog.setSun(d, e);
    for (const fn of this.listeners) fn(this);
  }

  /**
   * 太陽のまわりのまぶしさをスカイシェーダーで描くか（ブルームのない画質「中」「低」）。
   * ブルームがあるときは円盤だけにして、光芒はブルームに任せる
   */
  setGlow(enabled: boolean): void {
    const g = SKY_CONFIG.glow;
    const u = this.mesh.material.uniforms.uGlow;
    if (!u) return;
    const v = u.value as Vector4;
    if (enabled) v.set(g.strength, g.exponent, g.wideStrength, g.wideExponent);
    else v.set(0, 1, 0, 1);
  }

  /**
   * 高さ h（m）に届く直射光（雲に遮られる前。太陽か月の明るい方）。雲の光に使う（7-5）
   */
  keyLightAt(h: number): Rgb {
    const light = this.current.moonKey
      ? moonLight(NIGHT_CONFIG.moonIrradiance * this.night, NIGHT_CONFIG.moonTint)
      : extraterrestrialSun(SKY_CONFIG.sun.temperature, this.skySunE);
    const t = sunTransmittance(this.sun, h, undefined, this.current.moonKey ? 0 : this.lowSun);
    return [light[0] * t[0], light[1] * t[1], light[2] * t[2]];
  }

  /**
   * 雲の下面を下から照らす光（7-5b）: 低い太陽の光が地表近くを通って雲の底に当たる。
   * 地表の高さの直射光（曇天は遮られた後）× 低い太陽の重み × LOW_SUN_CONFIG.cloudUnder。昼・夜は 0
   */
  cloudUnderLight(): Rgb {
    if (this.current.moonKey) return [0, 0, 0];
    const k = this.lowSun * LOW_SUN_CONFIG.cloudUnder;
    const c = this.current.sun;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  /** ライトの色・強さと露出 */
  get lighting(): Readonly<WeatherLighting> {
    return this.current;
  }

  /** 霧と背景に使う地平線の色（リニア） */
  get horizonColor(): Color {
    const h = this.current.horizon;
    return new Color().setRGB(h[0], h[1], h[2]);
  }

  /** 太陽を動かしたときの通知を購読する */
  onChange(fn: AtmosphereListener): void {
    this.listeners.push(fn);
  }

  update(camera: Readonly<Vec3>): void {
    this.mesh.position.set(camera.x, camera.y, camera.z);
  }
}

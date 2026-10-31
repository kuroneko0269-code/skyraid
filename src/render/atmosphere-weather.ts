// 天候込みの光（7-5。Three.js 非依存）: 太陽 + 月の空、曇天の灰色の空、直射光の向き、昼と夜の露出。
// シェーダーの atmoSky（atmosphere-glsl.ts）と同じ混ぜ方。atmosphere-model.ts が 300 行を超えるので分けた
import { EXPOSURE_CONFIG, SKY_CONFIG } from '../data/sky';
import type { Vec3 } from '../flight/math';
import {
  computeExposure,
  extraterrestrialSun,
  luminance,
  skyRadiance,
  sunTransmittance,
  type AtmosphereParams,
  type Rgb,
  type SkyLighting,
} from './atmosphere-model';

/** 天候の光源: 太陽（夜は明るさ 0）と月、曇天の割合 */
export interface WeatherLightInput {
  /** 太陽の向きと明るさ（大気の外の放射照度。SKY_CONFIG.sun.irradiance × 太陽の重み） */
  readonly sun: Readonly<Vec3>;
  readonly sunE: number;
  /** 月の向きと明るさ（0 で月なし） */
  readonly moon: Readonly<Vec3>;
  readonly moonE: number;
  readonly overcast: number;
  /** 夜らしさ（0〜1）。露出を夜の固定露出へ混ぜる */
  readonly night: number;
  /** 露出の補正（EV） */
  readonly exposureBias: number;
  /** 低い太陽の重み（0〜1。7-5b。省略で 0 = 4-1 の式のまま） */
  readonly lowSun?: number;
}

/** 天候込みの光。SkyLighting に直射光の向きと曇天の空を足したもの */
export interface WeatherLighting extends SkyLighting {
  /** 直射光の向き（太陽か月の、地上で明るい方） */
  keyDir: Vec3;
  /** 直射光が月か */
  moonKey: boolean;
  /** 雲に遮られる前の直射光（雲の上面・雲の層の光に使う） */
  keyUnblocked: Rgb;
  /** 曇天の空の天頂の明るさ（CIE の曇天: L = Lz × (1 + 2 sin 仰角) / 3） */
  overcastZenith: Rgb;
  /** 昼の自動露出（夜の固定露出と混ぜる前。上限込み） */
  dayExposure: number;
}

export interface NightExposureConfig {
  readonly exposure: number;
  /** 夜の曇天で固定露出を上げる割合（省略で 0） */
  readonly overcastBoost?: number;
}

/** 月の色（輝度 1 に正規化した色味 × 太陽と同じ色温度） */
export function moonLight(
  moonE: number,
  tint: readonly [number, number, number],
  kelvin: number = SKY_CONFIG.sun.temperature,
): Rgb {
  const base = extraterrestrialSun(kelvin, moonE);
  const t = normalizedTint(tint);
  return [base[0] * t[0], base[1] * t[1], base[2] * t[2]];
}

/** 色味を輝度 1 に正規化する */
export function normalizedTint(tint: readonly [number, number, number]): Rgb {
  const l = luminance(tint) || 1;
  return [tint[0] / l, tint[1] / l, tint[2] / l];
}

/**
 * 露出: 昼の自動露出（上限 maxExposure）と夜の固定露出を夜らしさで混ぜ、天候の補正（EV）を掛ける。
 * 夕方に自動露出が上がりすぎる問題（4-1）は上限 3.0、夜は固定露出なので月夜を昼のように明るく写さない
 */
export function weatherExposure(
  dayExposure: number,
  night: number,
  biasEv: number,
  nightExposure: number,
  maxExposure: number = EXPOSURE_CONFIG.maxExposure,
): number {
  const day = Math.min(dayExposure, maxExposure);
  const n = Math.min(1, Math.max(0, night));
  const e = (day + (nightExposure - day) * n) * Math.pow(2, biasEv);
  return Math.min(e, maxExposure);
}

/**
 * 天候込みの光を計算する（天候・時刻が変わったときだけ呼ぶ）。空の放射照度は太陽と月の空を数値積分し、
 * 曇天は「晴れの空 + 遮った直射光の一部」を灰色にした空へ overcast で混ぜる（シェーダーの atmoSky と同じ混ぜ方）
 */
export function computeWeatherLighting(
  input: WeatherLightInput,
  moonTint: readonly [number, number, number],
  overcastCfg: {
    readonly directBlock: number;
    readonly diffuseTransfer: number;
    readonly tint: readonly [number, number, number];
  },
  night: NightExposureConfig,
  p: AtmosphereParams = SKY_CONFIG.atmosphere,
): WeatherLighting {
  const sunLight = extraterrestrialSun(SKY_CONFIG.sun.temperature, input.sunE);
  const low = input.lowSun ?? 0;
  const mLight = moonLight(input.moonE, moonTint);
  const hasMoon = input.moonE > 0;
  const ts = sunTransmittance(input.sun, 0, p, low);
  const tm = sunTransmittance(input.moon, 0, p);
  const sunGround: Rgb = [sunLight[0] * ts[0], sunLight[1] * ts[1], sunLight[2] * ts[2]];
  const moonGround: Rgb = [mLight[0] * tm[0], mLight[1] * tm[1], mLight[2] * tm[2]];
  const sinSun = Math.max(input.sun.y, 0);
  const sinMoon = Math.max(input.moon.y, 0);

  // 晴れの空の放射照度（太陽 + 月）
  const clear: Rgb = [0, 0, 0];
  const nEl = 12;
  const nAz = 24;
  const dEl = Math.PI / 2 / nEl;
  const dAz = (2 * Math.PI) / nAz;
  for (let i = 0; i < nEl; i++) {
    const el = (i + 0.5) * dEl;
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    for (let j = 0; j < nAz; j++) {
      const az = (j + 0.5) * dAz;
      const dir = { x: Math.sin(az) * cosEl, y: sinEl, z: -Math.cos(az) * cosEl };
      const w = sinEl * cosEl * dEl * dAz;
      const l = skyRadiance(dir, input.sun, sunLight, 0, p, low);
      const m = hasMoon ? skyRadiance(dir, input.moon, mLight, 0, p) : null;
      for (let k = 0; k < 3; k++) clear[k] = (clear[k] ?? 0) + ((l[k] ?? 0) + (m?.[k] ?? 0)) * w;
    }
  }

  // 直射光は地上で明るい方の向き（夕暮れの間で入れ替わる。どちらも暗いところで切り替わる）
  const sunHoriz = luminance(sunGround) * sinSun;
  const moonHoriz = luminance(moonGround) * sinMoon;
  const moonKey = hasMoon && moonHoriz > sunHoriz;
  const keyDir = moonKey ? { ...input.moon } : { ...input.sun };
  const keyUnblocked: Rgb = moonKey ? moonGround : sunGround;
  const o = Math.min(1, Math.max(0, input.overcast));
  const block = o * overcastCfg.directBlock;
  const key: Rgb = [
    keyUnblocked[0] * (1 - block),
    keyUnblocked[1] * (1 - block),
    keyUnblocked[2] * (1 - block),
  ];

  // 曇天の空: 晴れの空 + 遮った直射光の一部を灰色に（輝度を保つ）
  const direct: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++)
    direct[k] = (sunGround[k] ?? 0) * sinSun + (moonGround[k] ?? 0) * sinMoon;
  const greyLum =
    luminance(clear) + luminance(direct) * overcastCfg.directBlock * overcastCfg.diffuseTransfer;
  const tint = normalizedTint(overcastCfg.tint);
  const grey: Rgb = [greyLum * tint[0], greyLum * tint[1], greyLum * tint[2]];
  // 水平面の放射照度 E = Lz × 7π/9（CIE の曇天）
  const zk = 9 / (7 * Math.PI);
  const overcastZenith: Rgb = [grey[0] * zk, grey[1] * zk, grey[2] * zk];
  const sky: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++) sky[k] = (clear[k] ?? 0) + ((grey[k] ?? 0) - (clear[k] ?? 0)) * o;

  const keySin = Math.max(keyDir.y, 0);
  const total: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++) total[k] = (key[k] ?? 0) * keySin + (sky[k] ?? 0);
  const bounce = EXPOSURE_CONFIG.bounceAlbedo;
  const ground: Rgb = [total[0] * bounce, total[1] * bounce, total[2] * bounce];

  const away = { x: -keyDir.x, y: 0, z: -keyDir.z };
  const len = Math.hypot(away.x, away.z) || 1;
  const hd = { x: away.x / len, y: 0, z: away.z / len };
  const hs = skyRadiance(hd, input.sun, sunLight, 0, p, low);
  const hm = hasMoon ? skyRadiance(hd, input.moon, mLight, 0, p) : [0, 0, 0];
  const horizon: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const c = (hs[k] ?? 0) + (hm[k] ?? 0);
    horizon[k] = c + ((overcastZenith[k] ?? 0) / 3 - c) * o;
  }

  const groundLum = (EXPOSURE_CONFIG.groundAlbedo * luminance(total)) / Math.PI;
  const skyLum = luminance(sky) / Math.PI;
  const dayExposure = computeExposure(skyLum, groundLum);
  // 夜の曇り・雨は固定露出を上げ、天候の補正は昼の分だけ掛ける（真っ暗にしない）
  const n = Math.min(1, Math.max(0, input.night));
  const nightExp = night.exposure * (1 + (night.overcastBoost ?? 0) * o);
  const exposure = weatherExposure(dayExposure, n, input.exposureBias * (1 - n), nightExp);
  return {
    sun: key,
    skyIrradiance: sky,
    groundIrradiance: ground,
    horizon,
    exposure,
    keyDir,
    moonKey,
    keyUnblocked,
    overcastZenith,
    dayExposure,
  };
}

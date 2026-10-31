// 大気散乱の計算（Three.js 非依存）。シェーダー（atmosphere.ts の GLSL）と同じ式を CPU でも計算し、
// 半球ライト・太陽光の色・露出・テストに使う。色はすべてリニア RGB（シーンの単位）
import { EXPOSURE_CONFIG, LOW_SUN_CONFIG, SKY_CONFIG } from '../data/sky';
import type { Vec3 } from '../flight/math';

export type Rgb = [number, number, number];

export interface AtmosphereParams {
  readonly rayleigh: readonly [number, number, number];
  readonly rayleighHeight: number;
  readonly mie: number;
  readonly mieAlbedo: number;
  readonly mieHeight: number;
  readonly mieG: number;
  readonly multiScatter: number;
}

const DEG = Math.PI / 180;
const THREE_OVER_16PI = 3 / (16 * Math.PI);
const ONE_OVER_4PI = 1 / (4 * Math.PI);

/** 方位・仰角（度）から太陽の方向（単位ベクトル、太陽へ向かう向き） */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  // 方位 0 = -Z（初期の進行方向）、90 = +X（右）
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

/**
 * 空気の厚さ（天頂方向を 1 とした光路長）。cosZenith は天頂角の cos。地平線より下は地平線と同じ。
 * Preetham の空（three の Sky.js）と同じ Kasten-Young 型の近似（地平線で約 36）
 */
export function airMass(cosZenith: number): number {
  const c = Math.max(cosZenith, 0);
  const zenithDeg = Math.acos(c) / DEG;
  return 1 / (c + 0.15 * Math.pow(93.885 - zenithDeg, -1.253));
}

/** Rayleigh の位相関数 */
export function rayleighPhase(cosTheta: number): number {
  return THREE_OVER_16PI * (1 + cosTheta * cosTheta);
}

/** Henyey-Greenstein の位相関数（Mie の近似） */
export function miePhase(cosTheta: number, g: number): number {
  const g2 = g * g;
  return (ONE_OVER_4PI * (1 - g2)) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
}

/** 色温度（K）の黒体の色（sRGB の 0〜1。Tanner Helland の近似）をリニアにして返す */
export function kelvinToLinear(kelvin: number): Rgb {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
}

function srgbToLinear(c: number): number {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Rec.709 の輝度 */
export function luminance(c: Readonly<Rgb>): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * 高さ h から上（向き cosZenith）の光学的厚さ。Rayleigh と Mie（消散）を足したもの。
 * 列密度 = スケールハイト × exp(-h / スケールハイト)
 */
function opticalDepth(p: AtmosphereParams, h: number, cosZenith: number, out: Rgb): Rgb {
  const m = airMass(cosZenith);
  const y = Math.max(h, 0);
  const nR = p.rayleighHeight * Math.exp(-y / p.rayleighHeight);
  const nM = p.mieHeight * Math.exp(-y / p.mieHeight);
  const mieExt = (p.mie / p.mieAlbedo) * nM;
  for (let i = 0; i < 3; i++) out[i] = ((p.rayleigh[i] ?? 0) * nR + mieExt) * m;
  return out;
}

/** オゾンの天頂の光学的厚さ（低い太陽の重み 1 のとき。7-5b） */
export const OZONE_DEPTH: readonly [number, number, number] = [0, 1, 2].map(
  (i) => (LOW_SUN_CONFIG.ozone[i] ?? 0) * LOW_SUN_CONFIG.ozoneColumn * LOW_SUN_CONFIG.ozoneScale,
) as [number, number, number];

/**
 * 高さ h で太陽（向き sun）から届く光の透過率。太陽が低いほど赤くなる。
 * low は低い太陽の重み（7-5b）: Rayleigh の光学的厚さを (1 + low × rayleighBoost) 倍、オゾンの吸収を足す
 */
export function sunTransmittance(
  sun: Readonly<Vec3>,
  h: number,
  p: AtmosphereParams = SKY_CONFIG.atmosphere,
  low = 0,
): Rgb {
  const m = airMass(sun.y);
  const y = Math.max(h, 0);
  const nR =
    p.rayleighHeight * Math.exp(-y / p.rayleighHeight) * (1 + low * LOW_SUN_CONFIG.rayleighBoost);
  const mieExt = (p.mie / p.mieAlbedo) * p.mieHeight * Math.exp(-y / p.mieHeight);
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tau = (p.rayleigh[i] ?? 0) * nR + mieExt + low * (OZONE_DEPTH[i] ?? 0);
    out[i] = Math.exp(-tau * m);
  }
  return out;
}

/** 低い太陽で散乱する高さ（7-5b）: 上を見るほど高い空気で散乱する（地平線は h のまま） */
export function scatterHeight(h: number, dirY: number, low: number): number {
  const c = LOW_SUN_CONFIG;
  return h + low * c.scatterHeight * Math.min(1, Math.max(0, dirY * c.scatterSlope));
}

/**
 * 高さ h から向き dir（単位ベクトル）に見た空の明るさ（散乱光、太陽の円盤は含まない）。
 * sunLight は大気の外での太陽の放射照度（色 × 強さ）。シェーダーの atmoSky と同じ式:
 * L = E × T_sun × (β_R·P_R + β_M·P_M + 多重散乱) / β_ext × (1 − exp(−τ))
 */
export function skyRadiance(
  dir: Readonly<Vec3>,
  sun: Readonly<Vec3>,
  sunLight: Readonly<Rgb>,
  h: number,
  p: AtmosphereParams = SKY_CONFIG.atmosphere,
  low = 0,
): Rgb {
  const tau = opticalDepth(p, h, dir.y, [0, 0, 0]);
  const ts = sunTransmittance(sun, scatterHeight(h, dir.y, low), p, low);
  const y = Math.max(h, 0);
  const nR = p.rayleighHeight * Math.exp(-y / p.rayleighHeight);
  const nM = p.mieHeight * Math.exp(-y / p.mieHeight);
  const cosTheta = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const pr = rayleighPhase(cosTheta);
  const pm = miePhase(cosTheta, p.mieG) * (1 + low * LOW_SUN_CONFIG.mieBoost);
  const ms = p.multiScatter * ONE_OVER_4PI;
  // 7-5b: 多重散乱も透過率の色に染める（輝度は保つ）
  const tsLum = Math.max(luminance(ts), 1e-6);
  const msTint = low * LOW_SUN_CONFIG.multiScatterTint;
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const sR = (p.rayleigh[i] ?? 0) * nR;
    const sM = p.mie * nM;
    const ext = sR + (p.mie / p.mieAlbedo) * nM;
    const msColor = 1 + ((ts[i] ?? 0) / tsLum - 1) * msTint;
    // 単一散乱は地上に届く太陽光（透過率を掛ける）、多重散乱は空全体から来るので透過率を掛けない
    const scatter = (ts[i] ?? 0) * (sR * pr + sM * pm) + (sR + sM) * ms * msColor;
    const t = tau[i] ?? 0;
    out[i] = ((sunLight[i] ?? 0) * scatter * (1 - Math.exp(-t))) / ext;
  }
  return out;
}

/** 大気の外での太陽の光（色温度の色をホワイトバランスで割ったもの × 放射照度） */
export function extraterrestrialSun(
  kelvin: number = SKY_CONFIG.sun.temperature,
  irradiance: number = SKY_CONFIG.sun.irradiance,
  whiteBalance: number = SKY_CONFIG.sun.whiteBalance,
): Rgb {
  const t = kelvinToLinear(kelvin);
  const w = kelvinToLinear(whiteBalance);
  const c: Rgb = [t[0] / w[0], t[1] / w[1], t[2] / w[2]];
  // 色温度の色は明るさが揃っていないので、輝度 1 に正規化してから強さを掛ける
  const k = irradiance / luminance(c);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** 空・太陽から求めた、ライトと露出に使う値（すべてリニア RGB） */
export interface SkyLighting {
  /** 地上に届く太陽光（平行光源の色 × 強さ。太陽に垂直な面の放射照度） */
  sun: Rgb;
  /** 空全体から水平面に届く放射照度（半球ライトの空側） */
  skyIrradiance: Rgb;
  /** 地面からの照り返し（半球ライトの地面側） */
  groundIrradiance: Rgb;
  /** 地平線の空の明るさ（太陽と反対の向き。霧の色の目安・背景色） */
  horizon: Rgb;
  /** 露出（トーンマッピング前の倍率） */
  exposure: number;
}

/**
 * 太陽の向きから、ライトの色・強さと露出を計算する。空の放射照度は半球を数値積分する
 * （起動時と太陽を動かしたときだけ呼ぶ）
 */
export function computeSkyLighting(
  sun: Readonly<Vec3>,
  h = 0,
  sunLight: Readonly<Rgb> = extraterrestrialSun(),
  p: AtmosphereParams = SKY_CONFIG.atmosphere,
): SkyLighting {
  const ts = sunTransmittance(sun, h, p);
  const sunAtGround: Rgb = [sunLight[0] * ts[0], sunLight[1] * ts[1], sunLight[2] * ts[2]];

  // 空の放射照度 E = ∫ L cosθ dω（仰角 × 方位の格子で積分）
  const sky: Rgb = [0, 0, 0];
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
      const l = skyRadiance(dir, sun, sunLight, h, p);
      // 立体角 cosEl dEl dAz、水平面への cos は sinEl
      const w = sinEl * cosEl * dEl * dAz;
      for (let k = 0; k < 3; k++) sky[k] = (sky[k] ?? 0) + (l[k] ?? 0) * w;
    }
  }

  const sinSun = Math.max(sun.y, 0);
  const total: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++) total[k] = (sunAtGround[k] ?? 0) * sinSun + (sky[k] ?? 0);
  const bounce = EXPOSURE_CONFIG.bounceAlbedo;
  const ground: Rgb = [total[0] * bounce, total[1] * bounce, total[2] * bounce];

  const away = { x: -sun.x, y: 0, z: -sun.z };
  const len = Math.hypot(away.x, away.z) || 1;
  const horizon = skyRadiance({ x: away.x / len, y: 0, z: away.z / len }, sun, sunLight, h, p);

  // 露出: 地面（反射率 groundAlbedo の拡散面）と空の平均の明るさから
  const groundLum = (EXPOSURE_CONFIG.groundAlbedo * luminance(total)) / Math.PI;
  const skyLum = luminance(sky) / Math.PI;
  const exposure = computeExposure(skyLum, groundLum);
  return { sun: sunAtGround, skyIrradiance: sky, groundIrradiance: ground, horizon, exposure };
}

/**
 * 露出を決める。空と地面の明るさの対数平均（重み groundWeight）が key になる倍率を基本にし、
 * 露出後の地面が minGround より暗くならないよう下限をかける（空が明るくても地形がつぶれない）。
 * 上限は maxExposure
 */
export function computeExposure(
  skyLuminance: number,
  groundLuminance: number,
  cfg: {
    key: number;
    groundWeight: number;
    minGround: number;
    maxExposure: number;
  } = EXPOSURE_CONFIG,
): number {
  const sky = Math.max(skyLuminance, 1e-6);
  const ground = Math.max(groundLuminance, 1e-6);
  const w = cfg.groundWeight;
  const logAverage = Math.exp(w * Math.log(ground) + (1 - w) * Math.log(sky));
  return Math.min(Math.max(cfg.key / logAverage, cfg.minGround / ground), cfg.maxExposure);
}

/**
 * 空気遠近で距離に掛ける倍率（カメラの高さ h で減る）。シェーダーの atmoAerial と同じ式
 */
export function aerialDistanceScale(
  h: number,
  cfg: {
    distanceScale: number;
    heightFalloff: number;
    lowFactor: number;
    lowFrom: number;
    lowTo: number;
  } = SKY_CONFIG.aerial,
): number {
  const y = Math.max(h, 0);
  const t = Math.min(1, Math.max(0, (y - cfg.lowFrom) / (cfg.lowTo - cfg.lowFrom)));
  const low = cfg.lowFactor + (1 - cfg.lowFactor) * t * t * (3 - 2 * t);
  return cfg.distanceScale * Math.exp(-y / cfg.heightFalloff) * low;
}

// 大気散乱の GLSL。atmosphere-model.ts と同じ式。定数は src/data/sky.ts から埋め込む
import { Color, ShaderChunk, ShaderLib, UniformsLib, type IUniform } from 'three';
import { OCEAN_CONFIG } from '../data/ocean';
import { LOW_SUN_CONFIG, SKY_CONFIG } from '../data/sky';
import { NIGHT_CONFIG, OVERCAST_CONFIG } from '../data/weather';
import { extraterrestrialSun, OZONE_DEPTH } from './atmosphere-model';
import { normalizedTint } from './atmosphere-weather';

/** vec4 の uniform の値。Vector4 にしないのは、UniformsUtils.clone で複製されず全マテリアルで共有するため */
export interface SharedVec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * 天候（7-5）の共有 uniform。霧のシェーダーチャンクを使う全マテリアル（標準のマテリアルも）に入れ、
 * 値のオブジェクトを共有するので書き換えると全部に効く。入っていないマテリアルでは 0（= 4-1 の晴れの昼と同じ）。
 * - uAtmoWeather: x = 空気遠近の倍率 − 1、y = 霧の消散係数（1/m、海面）、z = 曇天の割合、w = 未使用
 * - uAtmoMoon: xyz = 月の向き、w = 月の明るさ（0 で月なし）
 * - uAtmoGrey: xyz = 曇天の空の天頂の明るさ、w = 未使用
 * - uAtmoLowSun: x = 低い太陽の重み（朝焼け・夕焼けの散乱の項。0 で 4-1 のまま。7-5b）、yzw = 未使用
 */
export const ATMO_WEATHER_UNIFORMS: Record<
  'uAtmoWeather' | 'uAtmoMoon' | 'uAtmoGrey' | 'uAtmoLowSun',
  { value: SharedVec4 }
> = {
  uAtmoWeather: { value: { x: 0, y: 0, z: 0, w: 0 } },
  uAtmoMoon: { value: { x: 0, y: 1, z: 0, w: 0 } },
  uAtmoGrey: { value: { x: 0, y: 0, z: 0, w: 0 } },
  uAtmoLowSun: { value: { x: 0, y: 0, z: 0, w: 0 } },
};

const f = (x: number): string => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const v3 = (a: readonly number[]): string => `vec3(${a.map(f).join(', ')})`;

function commonGlsl(): string {
  const a = SKY_CONFIG.atmosphere;
  const sun = SKY_CONFIG.sun;
  // 放射照度 1 あたりの太陽の色（色温度 ÷ ホワイトバランス）。強さは uniform で掛ける
  const color = extraterrestrialSun(sun.temperature, 1, sun.whiteBalance);
  const sea = new Color(OCEAN_CONFIG.deepColor);
  const oc = OVERCAST_CONFIG;
  const ls = LOW_SUN_CONFIG;
  return /* glsl */ `
#ifndef ATMO_COMMON
#define ATMO_COMMON
uniform vec4 uAtmoWeather;
uniform vec4 uAtmoMoon;
uniform vec4 uAtmoGrey;
uniform vec4 uAtmoLowSun;
// 低い太陽（7-5b。LOW_SUN_CONFIG）: Rayleigh の倍率、オゾンの天頂の光学的厚さ、散乱する高さ・傾き、多重散乱の染め、Mie の倍率
const float ATMO_LOW_RAYLEIGH = ${f(ls.rayleighBoost)};
const vec3 ATMO_LOW_OZONE = ${v3(OZONE_DEPTH)};
const vec2 ATMO_LOW_SCATTER = vec2(${f(ls.scatterHeight)}, ${f(ls.scatterSlope)});
const float ATMO_LOW_MS = ${f(ls.multiScatterTint)};
const float ATMO_LOW_MIE = ${f(ls.mieBoost)};
const vec3 ATMO_MOON_TINT = ${v3(normalizedTint(NIGHT_CONFIG.moonTint))};
const float ATMO_FOG_H = ${f(oc.fogHeight)};
const float ATMO_DIRECT_BLOCK = ${f(oc.directBlock)};
const vec2 ATMO_OVC_ABOVE = vec2(${f(oc.aboveFrom)}, ${f(oc.aboveTo)});
const vec3 ATMO_BETA_R = ${v3(a.rayleigh)};
const float ATMO_BETA_M = ${f(a.mie)};
const float ATMO_BETA_M_EXT = ${f(a.mie / a.mieAlbedo)};
const float ATMO_H_R = ${f(a.rayleighHeight)};
const float ATMO_H_M = ${f(a.mieHeight)};
const float ATMO_G = ${f(a.mieG)};
const float ATMO_MS = ${f(a.multiScatter / (4 * Math.PI))};
const vec3 ATMO_SUN_COLOR = ${v3(color)};
const float ATMO_DIST_SCALE = ${f(SKY_CONFIG.aerial.distanceScale)};
const float ATMO_AERIAL_H = ${f(SKY_CONFIG.aerial.heightFalloff)};
const vec3 ATMO_AERIAL_LOW = vec3(${f(SKY_CONFIG.aerial.lowFactor)}, ${f(SKY_CONFIG.aerial.lowFrom)}, ${f(SKY_CONFIG.aerial.lowTo)});
const vec3 ATMO_SEA_ALBEDO = ${v3([sea.r, sea.g, sea.b])};
const float ATMO_SEA_REFLECT = ${f(OCEAN_CONFIG.reflectivity)};
// 描画距離の外の海面はすべて遠いので、海面のシェーダーの遠くと同じだけ上の空を映す（3-1 の事前修正）
const float ATMO_SEA_LIFT = ${f(OCEAN_CONFIG.horizonReflection.lift)};

// 空気の厚さ（天頂 = 1、地平線で約 36）。地平線より下は地平線と同じ
float atmoAirMass(float c) {
  c = max(c, 0.0);
  float z = degrees(acos(c));
  return 1.0 / (c + 0.15 * pow(93.885 - z, -1.253));
}

// 高さ h で太陽から届く光の透過率。低い太陽（7-5b）は Rayleigh を強め、オゾンの吸収を足す
vec3 atmoSunTransmittance(vec3 sun, float h) {
  float y = max(h, 0.0);
  float low = uAtmoLowSun.x;
  vec3 depth = ATMO_BETA_R * ATMO_H_R * exp(-y / ATMO_H_R) * (1.0 + low * ATMO_LOW_RAYLEIGH)
    + ATMO_BETA_M_EXT * ATMO_H_M * exp(-y / ATMO_H_M) + low * ATMO_LOW_OZONE;
  return exp(-depth * atmoAirMass(sun.y));
}

// 高さ h から向き dir に見た空の散乱光（太陽の円盤なし）。sunE は太陽の放射照度
vec3 atmoSkyFrom(vec3 dir, vec3 sun, float sunE, float h) {
  float y = max(h, 0.0);
  float nR = ATMO_H_R * exp(-y / ATMO_H_R);
  float nM = ATMO_H_M * exp(-y / ATMO_H_M);
  vec3 sR = ATMO_BETA_R * nR;
  float sM = ATMO_BETA_M * nM;
  vec3 ext = sR + ATMO_BETA_M_EXT * nM;
  vec3 tau = ext * atmoAirMass(dir.y);
  float low = uAtmoLowSun.x;
  // 7-5b: 上を見るほど高い空気で散乱する（太陽からの光路が短い）。地平線は h のまま
  vec3 ts = atmoSunTransmittance(sun, h + low * ATMO_LOW_SCATTER.x * clamp(dir.y * ATMO_LOW_SCATTER.y, 0.0, 1.0));
  float c = dot(dir, sun);
  float pr = 0.05968310 * (1.0 + c * c);
  float g2 = ATMO_G * ATMO_G;
  float pm = 0.07957747 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * ATMO_G * c, 1.5) * (1.0 + low * ATMO_LOW_MIE);
  // 多重散乱も透過率の色に染める（輝度は保つ）
  float tsLum = max(dot(ts, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  vec3 msColor = 1.0 + (ts / tsLum - 1.0) * (low * ATMO_LOW_MS);
  vec3 scatter = ts * (sR * pr + sM * pm) + (sR + sM) * ATMO_MS * msColor;
  return ATMO_SUN_COLOR * sunE * scatter * (1.0 - exp(-tau)) / ext;
}

// 曇天の割合（雲の層より上では晴れの空に戻す。7-5）
float atmoOvercastAt(float h) {
  return uAtmoWeather.z * (1.0 - smoothstep(ATMO_OVC_ABOVE.x, ATMO_OVC_ABOVE.y, h));
}

// 天候込みの空（7-5）: 太陽の空 + 月の空（青白い）を、曇天の灰色の空（CIE の曇天の明るさの分布）へ混ぜる。
// 晴れの昼（共有 uniform が 0）は 4-1 の atmoSky と同じ
vec3 atmoSky(vec3 dir, vec3 sun, float sunE, float h) {
  vec3 c = sunE > 1e-5 ? atmoSkyFrom(dir, sun, sunE, h) : vec3(0.0);
  if (uAtmoMoon.w > 0.0) c += atmoSkyFrom(dir, uAtmoMoon.xyz, uAtmoMoon.w, h) * ATMO_MOON_TINT;
  float o = atmoOvercastAt(h);
  if (o > 0.0) c = mix(c, uAtmoGrey.rgb * (1.0 + 2.0 * max(dir.y, 0.0)) / 3.0, o);
  return c;
}

// 高さ h0 → h1 の線分に沿った平均密度（海面 = 1）
float atmoAvgDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  float e0 = exp(-h0 / H);
  if (abs(dh) < 1.0) return e0;
  return H * (e0 - exp(-h1 / H)) / dh;
}

// 高さ h0 → h1 の線分の空気遠近の消散係数（距離の倍率込み）。倍率はカメラの高さ h0 で減らす
// （地表付近は距離 3 倍、上空では霞が薄くなる。高度 500m 以下はさらに 0.8 倍（4-7）。
// atmosphere-model.ts の aerialDistanceScale）
// 7-5: 天候の空気遠近の倍率（uAtmoWeather.x + 1）と、霧（視程から決めた消散係数。距離の倍率は掛けない）を足す
vec3 atmoAerialDensity(float h0, float h1) {
  vec3 density = ATMO_BETA_R * atmoAvgDensity(h0, h1, ATMO_H_R) + ATMO_BETA_M_EXT * atmoAvgDensity(h0, h1, ATMO_H_M);
  float low = mix(ATMO_AERIAL_LOW.x, 1.0, smoothstep(ATMO_AERIAL_LOW.y, ATMO_AERIAL_LOW.z, h0));
  vec3 aerial = density * ATMO_DIST_SCALE * exp(-h0 / ATMO_AERIAL_H) * low * (1.0 + uAtmoWeather.x);
  return aerial + uAtmoWeather.y * atmoAvgDensity(h0, h1, ATMO_FOG_H);
}

// 地平線より下の背景（描画距離の外の海面を空気遠近ごしに見た色）。上は空そのもの。
// 空の色（地平線の霞）だけにすると、上空から見下ろしたとき描画距離の果てが白く溶けて画面が白くなる
// sky は同じ向きの atmoSky（呼ぶ側で計算済みのもの）
vec3 atmoBackgroundSky(vec3 dir, vec3 sky, vec3 sun, float sunE, float h) {
  if (dir.y >= 0.0) return sky;
  float y = max(h, 0.0);
  float t = y / max(-dir.y, 1e-3);
  // 海面: 水の中から出てくる光（太陽 + 空。空の放射照度は仰角 25° の空の明るさ × π で近似）+ 空の反射
  vec2 side = normalize(vec2(-sun.z, sun.x) + vec2(1e-5, 0.0));
  vec3 skyIrr = 3.14159265 * atmoSky(vec3(side.x * 0.9063, 0.4226, side.y * 0.9063), sun, sunE, 0.0);
  vec3 sunIrr = ATMO_SUN_COLOR * sunE * atmoSunTransmittance(sun, 0.0) * max(sun.y, 0.0);
  // 7-5: 月の直射光、曇天は直射光を遮る
  if (uAtmoMoon.w > 0.0)
    sunIrr += ATMO_SUN_COLOR * ATMO_MOON_TINT * uAtmoMoon.w * atmoSunTransmittance(uAtmoMoon.xyz, 0.0) * max(uAtmoMoon.y, 0.0);
  sunIrr *= 1.0 - atmoOvercastAt(0.0) * ATMO_DIRECT_BLOCK;
  float c = 1.0 - clamp(-dir.y, 0.0, 1.0);
  float F = 0.02 + 0.98 * c * c * c * c * c;
  vec3 sea = ATMO_SEA_ALBEDO * (sunIrr + skyIrr) / 3.14159265 * (1.0 - F)
    + atmoSky(normalize(vec3(dir.x, -dir.y + ATMO_SEA_LIFT, dir.z)), sun, sunE, 0.0) * (F * ATMO_SEA_REFLECT);
  vec3 ext = exp(-atmoAerialDensity(y, 0.0) * t);
  return sea * ext + sky * (1.0 - ext);
}
vec3 atmoBackground(vec3 dir, vec3 sun, float sunE, float h) {
  return atmoBackgroundSky(dir, atmoSky(dir, sun, sunE, h), sun, sunE, h);
}

// 空気遠近: カメラ cam から点 p までの透過率 ext と散乱光 ins（色 = 同じ向きの空の色 × (1 − 透過率)）。
// sunPacked = 太陽の向き × 放射照度。fadeStart〜fadeEnd で描画距離の果てを背景（空、または地平線より
// 下なら遠くの海面）の色に溶かす
void atmoAerial(vec3 cam, vec3 p, vec3 sunPacked, float fadeStart, float fadeEnd, out vec3 ext, out vec3 ins) {
  float sunE = length(sunPacked);
  vec3 sun = sunPacked / max(sunE, 1e-6);
  vec3 v = p - cam;
  float d = length(v);
  vec3 dir = v / max(d, 1e-3);
  float h0 = max(cam.y, 0.0);
  float h1 = max(p.y, 0.0);
  vec3 e = exp(-atmoAerialDensity(h0, h1) * d);
  float fade = smoothstep(fadeStart, fadeEnd, d);
  vec3 sky = atmoSky(dir, sun, sunE, h0);
  ext = e * (1.0 - fade);
  ins = sky * (1.0 - e) * (1.0 - fade);
  if (fade > 0.0) ins += atmoBackgroundSky(dir, sky, sun, sunE, h0) * fade;
}
#endif
`;
}

/** 大気散乱の関数群（ShaderMaterial に埋め込む） */
export const ATMOSPHERE_GLSL = commonGlsl();

let installed = false;

/**
 * Three.js の霧のシェーダーチャンクを大気散乱の空気遠近に置き換える（最初のマテリアルのコンパイル前に 1 回）。
 * 霧の uniform を読み替える: fogColor = 太陽の向き × 放射照度、fogNear / fogFar = 描画距離の果てのフェード。
 * 計算は頂点ごと（遠くでは三角形より十分なめらか）。霧はトーンマッピングの前（リニアの HDR）に掛ける
 */
export function installAtmosphereChunks(): void {
  if (installed) return;
  installed = true;
  installWeatherUniforms();
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vAtmoExt;
  varying vec3 vAtmoIn;
  ${ATMOSPHERE_GLSL}
#endif
`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  atmoAerial(cameraPosition, cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz,
    fogColor, fogNear, fogFar, vAtmoExt, vAtmoIn);
#endif
`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vAtmoExt;
  varying vec3 vAtmoIn;
#endif
`;
  ShaderChunk.fog_fragment = '';
  // 元のトーンマッピングの前に空気遠近を掛ける（標準のマテリアルは fog_fragment がトーンマッピングの後にあるため）
  ShaderChunk.tonemapping_fragment =
    /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = gl_FragColor.rgb * vAtmoExt + vAtmoIn;
#endif
` + ShaderChunk.tonemapping_fragment;
}

/**
 * 天候の共有 uniform を、霧の uniform を持つ標準のシェーダー（ShaderLib）と UniformsLib.fog（ShaderMaterial が
 * 複製して使う）に足す（7-5）。値のオブジェクトは複製されないので、ATMO_WEATHER_UNIFORMS を書き換えると全部に効く
 */
function installWeatherUniforms(): void {
  const add = (target: Record<string, IUniform>): void => {
    for (const [k, u] of Object.entries(ATMO_WEATHER_UNIFORMS)) target[k] = u;
  };
  add(UniformsLib.fog as Record<string, IUniform>);
  for (const shader of Object.values(ShaderLib)) {
    const u = shader.uniforms as Record<string, IUniform>;
    if ('fogColor' in u) add(u);
  }
}

// 海面のシェーダー（4-2）。画質「中」以上（同心リング + ゲルストナー波）と「低」（平面 + うねり 1 本）。
// 波の式は gerstner.ts、雲の影は cloud-field.ts の CLOUD_GLSL、空の色は atmosphere-glsl.ts と同じ
import { OCEAN_CONFIG } from '../data/ocean';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl';
import { CLOUD_GLSL } from './cloud-field';
import { noiseChunk } from './ocean-noise-glsl';
import { RAIN_RIPPLE_GLSL } from './weather/rain-ripple-glsl';

const WAVE_COUNT = OCEAN_CONFIG.waves.length;

// 水の中で散乱して出てくる光（拡散面と同じ: 放射照度 / π）と空の反射
const lightChunk = /* glsl */ `
  // uSunDirection は直射光（昼は太陽、夜は月。7-5）、uSkySun / uSkySunE は空の計算に使う太陽そのもの
  uniform vec3 uSunDirection;
  uniform vec3 uSkySun;
  uniform float uSkySunE;
  uniform vec3 uSunIrr;
  uniform vec3 uSkyIrr;
  uniform float uReflectivity;
  // x = 持ち上げ始める距離、y = 持ち上げきる距離、z = 持ち上げる量（反射の向きの y に足す）
  uniform vec3 uHorizonLift;
  ${ATMOSPHERE_GLSL}
  vec3 oceanSky(vec3 r) {
    return atmoSky(normalize(vec3(r.x, max(abs(r.y), 0.02), r.z)), uSkySun, uSkySunE, max(cameraPosition.y, 0.0));
  }
  // 遠くの海面ほど少し上の空を映す（3-1 の事前修正）。近く（uHorizonLift.x 未満）は oceanSky と同じ
  vec3 oceanFarSky(vec3 r, float dist) {
    float lift = uHorizonLift.z * smoothstep(uHorizonLift.x, uHorizonLift.y, dist);
    return oceanSky(vec3(r.x, abs(r.y) + lift, r.z));
  }
  float oceanFresnel(float cosTheta) {
    float f = 1.0 - clamp(cosTheta, 0.0, 1.0);
    float f2 = f * f;
    return 0.02 + 0.98 * f2 * f2 * f;
  }
`;

// ---------------------------------------------------------------- 画質「中」以上
export const detailedVertexShader = /* glsl */ `
  #define WAVE_COUNT ${WAVE_COUNT}
  uniform float uTime;
  // xy = 進む向き、z = 波数、w = 振幅
  uniform vec4 uWaves[WAVE_COUNT];
  // x = 角振動数、y = 水平の寄り（鋭さ / 波数）
  uniform vec2 uWaveB[WAVE_COUNT];
  uniform float uSpacingK;
  uniform float uMinSpacing;
  uniform sampler2D uDepthTex;
  uniform float uDepthSize;
  uniform vec2 uShoal;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 xz = wp.xz;
    float depth = texture(uDepthTex, xz / uDepthSize + 0.5).r;
    float shoal = smoothstep(uShoal.x, uShoal.y, depth);
    // この頂点のあたりの格子の間隔。間隔が波長の 1/4 を超える波は表せないので消す
    float spacing = max(length(xz - cameraPosition.xz) * uSpacingK, uMinSpacing);
    vec3 disp = vec3(0.0);
    vec3 n = vec3(0.0, 1.0, 0.0);
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec4 w = uWaves[i];
      vec2 b = uWaveB[i];
      float len = 6.2831853 / w.z;
      float k = shoal * (1.0 - smoothstep(len * 0.125, len * 0.25, spacing));
      float phase = w.z * dot(w.xy, xz) - uTime * b.x;
      float c = cos(phase);
      float s = sin(phase);
      disp.xz += w.xy * (b.y * k * c);
      disp.y += w.w * k * s;
      // GPU Gems 1 の 1 章の法線
      float wa = w.z * w.w * k;
      n.xz -= w.xy * (wa * c);
      n.y -= b.y * w.z * k * s;
    }
    wp.xyz += disp;
    vWorldPos = wp.xyz;
    vNormal = n;
    vHeight = disp.y;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const detailedFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform int uLayerCount;
  uniform sampler2D uDepthTex;
  uniform float uDepthSize;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform float uDepthScale;
  uniform vec3 uSunColor;
  // x = 近くの α、y = 遠くの α、z = 強さ
  uniform vec3 uGlint;
  uniform vec4 uSss;
  uniform float uMaxAmp;
  // x = 泡の帯の幅、y = 寄せ返しの割合、z = 2π / 周期、w = 1 / ノイズの大きさ
  uniform vec4 uFoam;
  uniform float uFoamMaxDepth;
  uniform float uFoamAlbedo;
  uniform vec2 uWind;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  ${lightChunk}
  ${noiseChunk}
  ${RAIN_RIPPLE_GLSL}
  #ifdef CLOUD_SHADOW
    ${CLOUD_GLSL}
  #endif
  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec2 xz = vWorldPos.xz;
    float depth = texture(uDepthTex, xz / uDepthSize + 0.5).r;
    // 陸の上は描かない（4-2c）。海岸線を深度の比べ合い（浅い角度で交わるので精度が足りずちらつく）
    // ではなく、ワールドに固定した水深の格子の等高線で決める
    if (depth < 0.0) discard;
    vec3 eyeVec = cameraPosition - vWorldPos;
    float dist = length(eyeVec);
    vec3 V = eyeVec / dist;
    float near;
    float footprint = oceanFootprint(xz);
    vec2 slope = oceanRipples(xz, dist, footprint, uTime, uLayerCount, near);
    // 雨の波紋（7-5）
    slope += oceanRainRipple(xz, footprint, uTime);
    vec3 n = normalize(normalize(vNormal) + vec3(-slope.x, 0.0, -slope.y));
    #ifdef CLOUD_SHADOW
      float shade = cloudShadow(vWorldPos);
    #else
      float shade = 1.0;
    #endif

    // 水の色: 浅瀬はターコイズ、沖は濃紺。下から出てくる光は太陽（雲の影で暗く）+ 空
    float shallow = exp(-max(depth, 0.0) / uDepthScale);
    vec3 irr = (uSunIrr * shade + uSkyIrr) / PI;
    vec3 body = mix(uDeepColor, uShallowColor, shallow) * irr;
    // 水面下の散乱: 太陽の方を見ると、波の山が透けて明るい
    vec3 sunH = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + 1e-5);
    float toward = pow(clamp(dot(-V, sunH), 0.0, 1.0), 3.0);
    float crest = clamp(vHeight / uMaxAmp + 0.4, 0.0, 1.0);
    body += uSss.rgb * uSss.w * toward * crest * uSunIrr * shade / PI;

    float F = oceanFresnel(dot(n, V));
    vec3 color = body * (1.0 - F) + oceanFarSky(reflect(-V, n), dist) * (F * uReflectivity);

    // 太陽の照り返し（GGX + Schlick + Kelemen の可視項）。遠く（さざ波が弱い・消えた所）はさざ波を
    // 粗さとして広げる
    float a = mix(uGlint.y, uGlint.x, near);
    float a2 = a * a;
    vec3 H = normalize(uSunDirection + V);
    float NdotH = max(dot(n, H), 0.0);
    float NdotL = max(dot(n, uSunDirection), 0.0);
    float LdotH = max(dot(uSunDirection, H), 0.0);
    float dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    vec3 spec = uSunColor * (shade * D * oceanFresnel(LdotH) * 0.25 / max(LdotH * LdotH, 0.05) * NdotL * uGlint.z);
    spec = oceanGlintBand(spec, V, normalize(vNormal), uSunDirection);

    // 海岸の泡: 海岸線の近く（水深 ÷ 水深の勾配 ≒ 海岸線までの距離）の白い帯。
    // 帯の端がゆっくり寄せては返し、ノイズでちぎれる
    float foam = 0.0;
    if (depth < uFoamMaxDepth) {
      float e = uDepthSize / float(textureSize(uDepthTex, 0).x);
      vec2 uv = xz / uDepthSize + 0.5;
      float gx = texture(uDepthTex, uv + vec2(e / uDepthSize, 0.0)).r - depth;
      float gz = texture(uDepthTex, uv + vec2(0.0, e / uDepthSize)).r - depth;
      float shoreDist = max(depth, 0.0) / max(length(vec2(gx, gz)) / e, 0.002);
      float swing = sin(uTime * uFoam.z - shoreDist * 0.25);
      float edge = uFoam.x * (1.0 + uFoam.y * swing);
      float band = 1.0 - smoothstep(edge * 0.25, edge, shoreDist);
      if (band > 0.0) {
        // ちぎれ具合のノイズ。画素より細かくなる遠くでは平均（0.5）にする（4-2c）。
        // 細かいまま描くと、画素ごとにまだらになってカメラが少し動くだけでちらつく
        float fine = smoothstep(uRipplePixel.x / uFoam.w, uRipplePixel.y / uFoam.w, footprint);
        float breakup = 0.5;
        if (fine < 1.0) {
          vec2 p = (xz - uWind * uTime) * uFoam.w;
          breakup += (0.65 * oceanNoise(p).x + 0.35 * oceanNoise(p * 2.7 + 5.1).x) * (1.0 - fine);
        }
        foam = smoothstep(0.45, 0.8, band * breakup + band * 0.25);
      }
    }
    color = mix(color + spec, uFoamAlbedo * irr, foam);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- 画質「低」（簡易版）
export const simpleVertexShader = /* glsl */ `
  uniform float uTime;
  // うねり 1 本（正弦波）: xy = 向き、z = 波数、w = 振幅
  uniform vec4 uSimpleWave;
  uniform float uSimpleOmega;
  uniform vec3 uDeepColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vBody;
  varying vec3 vSky;
  ${lightChunk}
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float phase = dot(uSimpleWave.xy, wp.xz) * uSimpleWave.z - uTime * uSimpleOmega;
    wp.y += uSimpleWave.w * sin(phase);
    vec2 grad = uSimpleWave.w * uSimpleWave.z * cos(phase) * uSimpleWave.xy;
    vWorldPos = wp.xyz;
    vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
    // 水の色と空の色は頂点で計算する（フレネルの混ぜ方だけ画素ごと）
    vec3 eyeVec = cameraPosition - wp.xyz;
    vec3 toEye = normalize(eyeVec);
    vBody = uDeepColor * (uSunIrr + uSkyIrr) / PI;
    vSky = oceanFarSky(reflect(-toEye, vNormal), length(eyeVec));
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const simpleFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uReflectivity;
  uniform float uSunShininess;
  uniform float uSunSpecular;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vBody;
  varying vec3 vSky;
  ${noiseChunk}
  #include <common>
  #include <fog_pars_fragment>
  float oceanFresnel(float cosTheta) {
    float f = 1.0 - clamp(cosTheta, 0.0, 1.0);
    float f2 = f * f;
    return 0.02 + 0.98 * f2 * f2 * f;
  }
  void main() {
    vec3 eyeVec = cameraPosition - vWorldPos;
    float dist = length(eyeVec);
    vec3 V = eyeVec / dist;
    float near;
    vec2 slope = oceanRipples(vWorldPos.xz, dist, oceanFootprint(vWorldPos.xz), uTime, 1, near);
    vec3 n = normalize(normalize(vNormal) + vec3(-slope.x, 0.0, -slope.y));
    float F = oceanFresnel(dot(n, V)) * uReflectivity;
    vec3 color = mix(vBody, vSky, F);
    vec3 r = reflect(-V, n);
    vec3 spec = uSunColor * pow(max(dot(r, uSunDirection), 0.0), uSunShininess) * uSunSpecular;
    color += oceanGlintBand(spec, V, normalize(vNormal), uSunDirection);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

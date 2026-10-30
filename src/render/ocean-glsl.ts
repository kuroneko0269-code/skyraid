// 海面のシェーダー（4-2）。画質「中」以上（同心リング + ゲルストナー波）と「低」（平面 + うねり 1 本）。
// 波の式は gerstner.ts、雲の影は cloud-field.ts の CLOUD_GLSL、空の色は atmosphere-glsl.ts と同じ
import { OCEAN_CONFIG } from '../data/ocean';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl';
import { CLOUD_GLSL } from './cloud-field';

const WAVE_COUNT = OCEAN_CONFIG.waves.length;
export const MAX_NORMAL_LAYERS = OCEAN_CONFIG.normalLayers.length;

// 値と微分を返す 2D 勾配ノイズ（Inigo Quilez の noised）。ハッシュは正弦を使わない Dave Hoskins の hash22
const noiseChunk = /* glsl */ `
  vec2 oceanHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
  }
  // x = 値（約 -0.7〜0.7）、yz = 微分
  vec3 oceanNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    vec2 ga = oceanHash(i);
    vec2 gb = oceanHash(i + vec2(1.0, 0.0));
    vec2 gc = oceanHash(i + vec2(0.0, 1.0));
    vec2 gd = oceanHash(i + vec2(1.0, 1.0));
    float va = dot(ga, f);
    float vb = dot(gb, f - vec2(1.0, 0.0));
    float vc = dot(gc, f - vec2(0.0, 1.0));
    float vd = dot(gd, f - vec2(1.0, 1.0));
    float k = va - vb - vc + vd;
    return vec3(
      va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k,
      ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va)
    );
  }
  // さざ波の層: xy = 流れる速度（m/s）、z = 1 / 模様の大きさ、w = 傾きの強さ。fade = 消える距離
  uniform vec4 uLayers[${MAX_NORMAL_LAYERS}];
  uniform vec2 uLayerFade[${MAX_NORMAL_LAYERS}];
  // n 層ぶんの傾き（xz）。near は先頭の層の残り具合（遠くで 0）
  vec2 oceanRipples(vec2 xz, float dist, float time, int n, out float near) {
    vec2 slope = vec2(0.0);
    near = 0.0;
    for (int i = 0; i < ${MAX_NORMAL_LAYERS}; i++) {
      if (i >= n) break;
      vec4 l = uLayers[i];
      float fade = 1.0 - smoothstep(uLayerFade[i].x, uLayerFade[i].y, dist);
      if (i == 0) near = fade;
      if (fade <= 0.0) continue;
      vec3 nd = oceanNoise((xz - l.xy * time) * l.z + float(i) * 17.3);
      slope += nd.yz * l.w * fade;
    }
    return slope;
  }
`;

// 水の中で散乱して出てくる光（拡散面と同じ: 放射照度 / π）と空の反射
const lightChunk = /* glsl */ `
  uniform vec3 uSunDirection;
  uniform float uSunE;
  uniform vec3 uSunIrr;
  uniform vec3 uSkyIrr;
  uniform float uReflectivity;
  ${ATMOSPHERE_GLSL}
  vec3 oceanSky(vec3 r) {
    return atmoSky(normalize(vec3(r.x, max(abs(r.y), 0.02), r.z)), uSunDirection, uSunE, max(cameraPosition.y, 0.0));
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
  #ifdef CLOUD_SHADOW
    ${CLOUD_GLSL}
  #endif
  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec3 eyeVec = cameraPosition - vWorldPos;
    float dist = length(eyeVec);
    vec3 V = eyeVec / dist;
    vec2 xz = vWorldPos.xz;
    float near;
    vec2 slope = oceanRipples(xz, dist, uTime, uLayerCount, near);
    vec3 n = normalize(normalize(vNormal) + vec3(-slope.x, 0.0, -slope.y));
    #ifdef CLOUD_SHADOW
      float shade = cloudShadow(vWorldPos);
    #else
      float shade = 1.0;
    #endif

    // 水の色: 浅瀬はターコイズ、沖は濃紺。下から出てくる光は太陽（雲の影で暗く）+ 空
    float depth = texture(uDepthTex, xz / uDepthSize + 0.5).r;
    float shallow = exp(-max(depth, 0.0) / uDepthScale);
    vec3 irr = (uSunIrr * shade + uSkyIrr) / PI;
    vec3 body = mix(uDeepColor, uShallowColor, shallow) * irr;
    // 水面下の散乱: 太陽の方を見ると、波の山が透けて明るい
    vec3 sunH = normalize(vec3(uSunDirection.x, 0.0, uSunDirection.z) + 1e-5);
    float toward = pow(clamp(dot(-V, sunH), 0.0, 1.0), 3.0);
    float crest = clamp(vHeight / uMaxAmp + 0.4, 0.0, 1.0);
    body += uSss.rgb * uSss.w * toward * crest * uSunIrr * shade / PI;

    float F = oceanFresnel(dot(n, V));
    vec3 color = body * (1.0 - F) + oceanSky(reflect(-V, n)) * (F * uReflectivity);

    // 太陽の照り返し（GGX + Schlick + Kelemen の可視項）。遠くはさざ波を粗さとして広げる
    float a = mix(uGlint.y, uGlint.x, near);
    float a2 = a * a;
    vec3 H = normalize(uSunDirection + V);
    float NdotH = max(dot(n, H), 0.0);
    float NdotL = max(dot(n, uSunDirection), 0.0);
    float LdotH = max(dot(uSunDirection, H), 0.0);
    float dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    vec3 spec = uSunColor * (shade * D * oceanFresnel(LdotH) * 0.25 / max(LdotH * LdotH, 0.05) * NdotL * uGlint.z);

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
        vec2 p = (xz - uWind * uTime) * uFoam.w;
        float breakup = 0.5 + 0.65 * oceanNoise(p).x + 0.35 * oceanNoise(p * 2.7 + 5.1).x;
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
    vec3 toEye = normalize(cameraPosition - wp.xyz);
    vBody = uDeepColor * (uSunIrr + uSkyIrr) / PI;
    vSky = oceanSky(reflect(-toEye, vNormal));
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
    vec2 slope = oceanRipples(vWorldPos.xz, dist, uTime, 1, near);
    vec3 n = normalize(normalize(vNormal) + vec3(-slope.x, 0.0, -slope.y));
    float F = oceanFresnel(dot(n, V)) * uReflectivity;
    vec3 color = mix(vBody, vSky, F);
    vec3 r = reflect(-V, n);
    color += uSunColor * pow(max(dot(r, uSunDirection), 0.0), uSunShininess) * uSunSpecular;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

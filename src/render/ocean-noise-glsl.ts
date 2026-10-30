// 海面のさざ波（法線ノイズ）と照り返しの帯の GLSL（4-2 / 4-2b）。ocean-glsl.ts の両方の画質で使う
import { OCEAN_CONFIG } from '../data/ocean';

export const MAX_NORMAL_LAYERS = OCEAN_CONFIG.normalLayers.length;

// 値と微分を返す 2D 勾配ノイズ（Inigo Quilez の noised）。ハッシュは正弦を使わない Dave Hoskins の hash22
export const noiseChunk = /* glsl */ `
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
  // 距離による弱め: x = 半分になる距離、y = 指数
  uniform vec2 uRippleFalloff;
  // 画素の大きさで消す範囲（模様の大きさに対する比）: x = 消し始め、y = 消しきり
  uniform vec2 uRipplePixel;
  // 1 画素が海面で覆う幅（m）。画面の縦横で長いほう（斜めに見ると奥行き方向に伸びる）
  float oceanFootprint(vec2 xz) {
    return max(length(dFdx(xz)), length(dFdy(xz)));
  }
  // n 層ぶんの傾き（xz）。near は先頭の層の残り具合（距離の弱めを含む。遠くで 0）。
  // 遠くほど振幅を下げ、画素より細かい層は消す（照り返しが画素単位でちらつかないように）
  vec2 oceanRipples(vec2 xz, float dist, float footprint, float time, int n, out float near) {
    float amp = 1.0 / (1.0 + pow(dist / uRippleFalloff.x, uRippleFalloff.y));
    vec2 slope = vec2(0.0);
    near = 0.0;
    for (int i = 0; i < ${MAX_NORMAL_LAYERS}; i++) {
      if (i >= n) break;
      vec4 l = uLayers[i];
      float cell = 1.0 / l.z;
      float fade = (1.0 - smoothstep(uLayerFade[i].x, uLayerFade[i].y, dist)) *
        (1.0 - smoothstep(cell * uRipplePixel.x, cell * uRipplePixel.y, footprint));
      if (i == 0) near = fade * amp;
      if (fade <= 0.0) continue;
      vec3 nd = oceanNoise((xz - l.xy * time) * l.z + float(i) * 17.3);
      slope += nd.yz * l.w * fade;
    }
    return slope * amp;
  }
  // 照り返しの帯: x = 内側の cos、y = 外側の cos、z = 帯の外の倍率、w = 帯の外の明るさの上限
  uniform vec4 uGlintBand;
  // 波のない海面（法線 n0）で太陽を映す向きに近いところ（帯）だけ照り返しを残し、外は弱めて頭打ちにする
  vec3 oceanGlintBand(vec3 spec, vec3 V, vec3 n0, vec3 sunDir) {
    float band = smoothstep(uGlintBand.y, uGlintBand.x, dot(reflect(-V, n0), sunDir));
    vec3 outside = spec * uGlintBand.z;
    float lum = dot(outside, vec3(0.2126, 0.7152, 0.0722));
    outside *= min(1.0, uGlintBand.w / max(lum, 1e-5));
    return mix(outside, spec, band);
  }
`;

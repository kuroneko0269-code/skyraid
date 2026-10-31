// 海面の雨の波紋（7-5。画質「中」以上の海のフラグメント）: 格子ごとに 1 つ、周期ごとに位置を変えて広がる輪を
// 2 層ずらして重ね、法線の傾きにする。1 画素が覆う幅が格子に対して大きい遠くでは消す（画素より細かい模様を描かない）
import { RAIN_CONFIG } from '../../data/weather';

const f = (x: number): string => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

const r = RAIN_CONFIG.ripple;

export const RAIN_RIPPLE_GLSL = /* glsl */ `
  uniform float uRain;
  float rainHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // 雨の波紋の傾き（xz）。footprint は 1 画素が海面で覆う幅（m）
  vec2 oceanRainRipple(vec2 xz, float footprint, float time) {
    if (uRain <= 0.001) return vec2(0.0);
    float fade = 1.0 - smoothstep(${f(r.cell * 0.12)}, ${f(r.cell * 0.35)}, footprint);
    if (fade <= 0.0) return vec2(0.0);
    vec2 s = vec2(0.0);
    for (int k = 0; k < 2; k++) {
      vec2 p = xz / ${f(r.cell)} + float(k) * vec2(0.37, 0.71);
      vec2 cell = floor(p);
      float h = rainHash(cell + float(k) * 17.0);
      float cycle = time / ${f(r.period)} + h;
      float phase = fract(cycle);
      // 周期ごとに輪の中心を変える
      float n = floor(cycle);
      vec2 c = vec2(rainHash(cell + n * 1.7 + 3.1), rainHash(cell + n * 2.3 + 7.7)) * 0.6 + 0.2;
      vec2 d = fract(p) - c;
      float rr = length(d);
      float w = (rr - phase * 0.45) * 22.0;
      float amp = (1.0 - phase) * exp(-w * w) * sin(w * 2.5);
      // 雨の強さで輪の数を減らす（弱い雨は格子の一部だけ）
      amp *= step(h, uRain);
      s += d / max(rr, 1e-3) * amp;
    }
    return s * ${f(r.slope)} * fade;
  }
`;

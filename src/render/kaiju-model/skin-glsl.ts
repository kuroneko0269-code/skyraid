// 怪獣ヴォルガスの皮膚のノイズ（6-1 の material.ts から。10-7e で皮膚のマテリアルを skin-material.ts へ移したので分けた）:
// 値のノイズ（亀裂・むら）と 3D のセルノイズ（6-1b の鱗。画質「低」）
export const NOISE = /* glsl */ `
float kjHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float kjNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(kjHash(i), kjHash(i + vec3(1, 0, 0)), f.x),
        mix(kjHash(i + vec3(0, 1, 0)), kjHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(kjHash(i + vec3(0, 0, 1)), kjHash(i + vec3(1, 0, 1)), f.x),
        mix(kjHash(i + vec3(0, 1, 1)), kjHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// 鱗: 3D のセルノイズ（最も近い点までの距離 F1 と 2 番目 F2）。F2 − F1 が小さい所が鱗の境目の溝
float kjScale(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(kjHash(i + g), kjHash(i + g + 17.3), kjHash(i + g + 41.9));
    float dd = length(g + o - f);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  // 鱗の中央が盛り上がり、境目で落ちる
  return smoothstep(0.0, 0.35, f2 - f1) * (1.0 - 0.5 * f1);
}
`;

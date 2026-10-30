// 雲のシェーダー（4-2）: 疑似体積（画質「中」以上）、ビルボード（「低」）、雲の中の霧（全画質）
import { CLOUD_CONFIG } from '../data/clouds';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl';
import { CLOUD_GLSL } from './cloud-field';

const f = (x: number): string => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

const v = CLOUD_CONFIG.volume;
const light = CLOUD_CONFIG.light;

// 光の共通部分: 太陽（Henyey-Greenstein の前方 + 後方の混合。等方 = 1 に正規化）と空の光
const lightChunk = /* glsl */ `
  uniform vec3 uAmbient;
  float cloudHg(float mu, float g) {
    float g2 = g * g;
    return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5);
  }
  float cloudPhase(float mu) {
    return mix(cloudHg(mu, ${f(light.backG)}), cloudHg(mu, ${f(light.forwardG)}), ${f(light.forwardWeight)});
  }
`;

// ---------------------------------------------------------------- 疑似体積（板 1 枚）
export const volumeVertexShader = /* glsl */ `
  // x = 下面を描くか、y = 上面を描くか（カメラが層の下なら下面だけ、上なら上面だけ、中なら両方）
  uniform vec2 uShow;
  uniform float uHalfSize;
  varying vec3 vWorld;
  const float CLOUD_BASE_V = ${f(CLOUD_CONFIG.base)};
  const float CLOUD_TOP_V = ${f(CLOUD_CONFIG.top)};
  void main() {
    // position: xz = -1〜1、y = 0（下面）/ 1（上面）
    float show = position.y < 0.5 ? uShow.x : uShow.y;
    vec3 wp = vec3(
      cameraPosition.x + position.x * uHalfSize,
      mix(CLOUD_BASE_V, CLOUD_TOP_V, position.y),
      cameraPosition.z + position.z * uHalfSize
    );
    vWorld = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    // 描かない面は画面外の 1 点につぶす（面積 0 で画素が出ない）
    if (show < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

export const volumeFragmentShader = /* glsl */ `
  #define MAX_STEPS ${v.maxSteps}
  uniform float uSteps;
  uniform float uInside;
  uniform vec3 uSunDir;
  uniform float uSunE;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vWorld;
  ${ATMOSPHERE_GLSL}
  ${CLOUD_GLSL}
  ${lightChunk}
  #include <common>
  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
    float tb = (CLOUD_BASE - ro.y) / ry;
    float tt = (CLOUD_TOP - ro.y) / ry;
    float t0 = max(min(tb, tt), 0.0);
    float t1 = min(max(tb, tt), min(t0 + ${f(v.maxMarch)}, fogFar));
    if (t1 <= t0) discard;
    float dt = (t1 - t0) / uSteps;
    // 各歩の中央で取る。層の外から入る視線は全画素が同じ高さの組で取るので、画素ごとのずらし
    // （ノイズ）なしでも縞にならない（ずらすと少ない歩数では砂のようなざらつきになる）
    float t = t0 + dt * 0.5;
    vec3 sunColor = ATMO_SUN_COLOR * uSunE * atmoSunTransmittance(uSunDir, CLOUD_BASE);
    vec3 sunLight = sunColor * cloudPhase(dot(rd, uSunDir));
    vec3 color = vec3(0.0);
    float T = 1.0;
    float tSum = 0.0;
    float wSum = 0.0;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (float(i) >= uSteps || T < 0.03) break;
      vec3 p = ro + rd * t;
      float d = cloudDensityAt(p, true);
      if (d > 0.002) {
        float hf = (p.y - CLOUD_BASE) / CLOUD_THICK;
        // 太陽の方へ 1 回だけ密度を取る（自分の影）。下ほど上の雲を通るので暗い
        float dl = cloudDensityAt(p + uSunDir * ${f(v.lightStep)}, false);
        float sunT = exp(-dl * CLOUD_EXT * ${f(v.lightStep)} * 1.5) * mix(0.45, 1.0, smoothstep(0.0, 0.8, hf));
        vec3 amb = uAmbient * mix(${f(light.ambientBottom)}, 1.0, hf);
        vec3 L = (sunLight * sunT + amb) * (${f(light.albedo)} / PI);
        float a = 1.0 - exp(-d * CLOUD_EXT * dt);
        color += T * a * L;
        tSum += T * a * t;
        wSum += T * a;
        T *= 1.0 - a;
      }
      t += dt;
    }
    // 層の中にいるとき、水平に近い視線は板に当たらない（描画距離の外）。境目が見えないよう水平に近いほど薄くする
    float alpha = (1.0 - T) * mix(1.0, smoothstep(0.0, 0.15, abs(rd.y)), uInside);
    color *= alpha / max(1.0 - T, 1e-4);
    if (alpha < 0.004) discard;
    // 空気遠近: 雲の平均の深さで、地形・海と同じ霧の式（遠くは空の色に溶けて消える）
    vec3 ext;
    vec3 ins;
    atmoAerial(ro, ro + rd * (tSum / max(wSum, 1e-4)), fogColor, fogNear, fogFar, ext, ins);
    // 乗算済みアルファ（ext は描画距離の果てで 0 になり、雲は後ろの空と同じ色 ins だけになる）
    gl_FragColor = vec4(color * ext + ins * alpha, alpha);
  }
`;

// ---------------------------------------------------------------- ビルボード（画質「低」）
export const billboardVertexShader = /* glsl */ `
  uniform vec2 uCloudOffset;
  uniform float uRadius;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec3 c = instanceMatrix[3].xyz;
    float w = length(instanceMatrix[0].xyz);
    float h = length(instanceMatrix[1].xyz);
    // カメラのまわり ±uRadius の正方形の中に回り込ませる（風で流れても数は減らない）
    vec2 rel = mod(c.xz + uCloudOffset - cameraPosition.xz + uRadius, 2.0 * uRadius) - uRadius;
    vec3 center = vec3(cameraPosition.x + rel.x, c.y, cameraPosition.z + rel.y);
    // カメラに正対（ビュー行列の右・上の向き）
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wp = center + right * (position.x * w) + up * (position.y * h);
    vFade = 1.0 - smoothstep(0.7, 1.0, max(abs(rel.x), abs(rel.y)) / uRadius);
    vUv = uv;
    vSeed = fract(c.x * 0.0131 + c.z * 0.0071);
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const billboardFragmentShader = /* glsl */ `
  uniform vec3 uSunColor;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  ${lightChunk}
  #include <common>
  #include <fog_pars_fragment>
  float bbHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float bbNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 u = fract(p);
    u = u * u * (3.0 - 2.0 * u);
    return mix(mix(bbHash(i), bbHash(i + vec2(1.0, 0.0)), u.x),
      mix(bbHash(i + vec2(0.0, 1.0)), bbHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    vec2 q = vUv * vec2(4.0, 2.0) + vSeed * 37.0;
    float n = bbNoise(q) * 0.5 + bbNoise(q * 2.1) * 0.3 + bbNoise(q * 4.3) * 0.2;
    // もこもこした輪郭（ノイズで半径を揺らす）と平らな底
    float r = length(p) + (n - 0.5) * 0.75;
    float shape = (1.0 - smoothstep(0.35, 0.95, r)) * smoothstep(-0.85, -0.45, p.y + (n - 0.5) * 0.3);
    float alpha = shape * vFade;
    if (alpha < 0.01) discard;
    // 上は太陽で明るく、底は暗い
    float hf = clamp(p.y * 0.5 + 0.5 + (n - 0.5) * 0.4, 0.0, 1.0);
    vec3 L = uSunColor * cloudPhase(0.0) * mix(0.35, 1.0, hf) + uAmbient * mix(${f(light.ambientBottom)}, 1.0, hf);
    gl_FragColor = vec4(L * (${f(light.albedo)} / PI), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------- 雲の中の霧（画面全体）
export const insideFogVertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const insideFogFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    gl_FragColor = vec4(uColor, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

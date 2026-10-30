// 地形の層のシェーダー（4-6。画質「中」以上）。傾斜と高さで砂浜 / 草地 / 森 / 高原 / 岩 / 崖 / 雪を混ぜ、
// 層ごとに違う粒の大きさの三面マッピングのノイズで明るさを揺らす。岩・崖は法線も揺らす（TERRAIN_NORMAL_DETAIL）。
// 森の密度は木の配置と同じ式（terrain-gen/forest.ts）。数値は src/data/terrain.ts の TERRAIN_DETAIL_CONFIG
import { Color } from 'three';
import { TERRAIN_CONFIG, TERRAIN_DETAIL_CONFIG } from '../data/terrain';
import { VEGETATION_CONFIG } from '../data/vegetation';
import { WIND_CONFIG } from '../data/wind';
import { forestGlsl } from './terrain-gen/forest';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** sRGB の 16 進 → GLSL の線形 RGB の vec3 */
function rgb(hex: number): string {
  const c = new Color(hex);
  return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
}

const vec3Of = (a: readonly number[]): string => `vec3(${a.map(f).join(', ')})`;

/** フラグメントシェーダーの #include <common> の後に足す関数群 */
export function terrainLayersGlsl(): string {
  const c = TERRAIN_DETAIL_CONFIG;
  const col = c.colors;
  const g = c.grain;
  const v = VEGETATION_CONFIG;
  const coast = TERRAIN_CONFIG.shape.coast;
  const wind = (WIND_CONFIG.direction * Math.PI) / 180;
  const nm = c.normal;
  const strataK = (2 * Math.PI) / c.strata.spacing;
  return /* glsl */ `
  varying vec3 vDetailPos;
  varying vec3 vDetailNormal;
  ${forestGlsl()}
  // 正弦を使わないハッシュ（大きな座標でも精度が落ちにくい。Dave Hoskins の hash12）
  float detailHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float detailNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 u = fract(p);
    u = u * u * (3.0 - 2.0 * u);
    float a = detailHash(i);
    float b = detailHash(i + vec2(1.0, 0.0));
    float c = detailHash(i + vec2(0.0, 1.0));
    float d = detailHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // 値ノイズと偏微分（x: 値、yz: d/dp）
  vec3 detailNoiseD(vec2 p) {
    vec2 i = floor(p);
    vec2 fr = fract(p);
    vec2 u = fr * fr * (3.0 - 2.0 * fr);
    vec2 du = 6.0 * fr * (1.0 - fr);
    float a = detailHash(i);
    float b = detailHash(i + vec2(1.0, 0.0));
    float c = detailHash(i + vec2(0.0, 1.0));
    float d = detailHash(i + vec2(1.0, 1.0));
    float k = a - b - c + d;
    return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
      du * (vec2(b - a, c - a) + k * u.yx));
  }
  // 三面マッピング: 法線の向きで 3 方向の投影を混ぜる（急斜面でも伸びない）。-0.5〜0.5
  float detailTriplanar(vec3 p, vec3 w) {
    return detailNoise(p.yz) * w.x + detailNoise(p.xz) * w.y + detailNoise(p.xy + 17.0) * w.z - 0.5;
  }
  // 三面マッピングのノイズのワールド座標での勾配（p の単位あたり）
  vec3 detailTriplanarGrad(vec3 p, vec3 w) {
    vec3 nx = detailNoiseD(p.yz);
    vec3 ny = detailNoiseD(p.xz);
    vec3 nz = detailNoiseD(p.xy + 17.0);
    return vec3(0.0, nx.y, nx.z) * w.x + vec3(ny.y, 0.0, ny.z) * w.y + vec3(nz.y, nz.z, 0.0) * w.z;
  }

  // 層の重み（法線の細部・森の影で使う）
  float tlRock;
  float tlCliff;
  float tlForestZone;
  float tlStrataPhase;

  vec3 terrainLayers() {
    vec3 p = vDetailPos;
    float dist = distance(p, cameraPosition);
    vec3 n = normalize(vDetailNormal);
    vec3 w = n * n;
    w *= w;
    w /= w.x + w.y + w.z;

    // 境目を乱すノイズ（-1〜1 程度）
    float bn = (detailNoise(p.xz / ${f(c.boundaryNoise.large)}) - 0.5) * 1.4
      + (detailNoise(p.xz / ${f(c.boundaryNoise.small)} + 5.0) - 0.5) * 0.6;
    float h = p.y;
    float hj = h + bn * ${f(c.boundaryNoise.heightJitter)};
    float slope = degrees(acos(clamp(n.y, 0.0, 1.0)));
    float sj = slope + bn * ${f(c.boundaryNoise.slopeJitter)};

    // 風下ほど砂浜が高くまで（高さ関数の coastSide と同じ向き。ノイズは境目用で代用）
    vec2 dir = p.xz / max(length(p.xz), 1.0);
    float along = dot(dir, vec2(${f(Math.cos(wind))}, ${f(Math.sin(wind))})) + bn * 0.15;
    float lee = smoothstep(${f(coast.sideFrom)}, ${f(coast.sideTo)}, along);
    float sandTop = mix(${f(c.sandTop.windward)}, ${f(c.sandTop.leeward)}, lee);

    vec3 albedo = ${rgb(col.seabed)};
    vec3 amp = ${vec3Of(g.sand)};
    float wSand = smoothstep(-8.0, -1.0, h);
    albedo = mix(albedo, ${rgb(col.sand)}, wSand);
    float wGrass = smoothstep(sandTop - 1.0, sandTop + 2.5, h + bn * 1.5);
    albedo = mix(albedo, ${rgb(col.grass)}, wGrass);
    amp = mix(amp, ${vec3Of(g.grass)}, wGrass);

    // 森: 木の配置と同じ密度 × 高度 × 傾斜。地面は暗い緑のまだら
    float fb = ${f(c.forestBlend.height)};
    float fs = ${f(c.forestBlend.slopeDeg)};
    tlForestZone = smoothstep(${f(v.minHeight)}, ${f(v.minHeight)} + fb, h)
      * (1.0 - smoothstep(${f(v.maxHeight)} - fb, ${f(v.maxHeight)}, h))
      * (1.0 - smoothstep(${f(v.maxSlopeDeg)} - fs, ${f(v.maxSlopeDeg)} + fs, slope));
    float wForest = forestDensity(p.xz) * tlForestZone;
    float patches = detailNoise(p.xz / 6.0) * 0.6 + detailNoise(p.xz / 1.7) * 0.4;
    albedo = mix(albedo, mix(${rgb(col.forest)}, ${rgb(col.forestLight)}, smoothstep(0.35, 0.75, patches)), wForest);
    amp = mix(amp, ${vec3Of(g.forest)}, wForest);

    // 高原 → 岩（高さ）、岩（傾斜 30°）、崖（傾斜 50°）
    float wAlpine = smoothstep(${f(c.alpineStart)} - 20.0, ${f(c.alpineStart)} + 20.0, hj);
    albedo = mix(albedo, ${rgb(col.alpine)}, wAlpine);
    amp = mix(amp, ${vec3Of(g.alpine)}, wAlpine);
    float sb = ${f(c.slopeBlendDeg)};
    tlRock = max(smoothstep(${f(c.rockStart)} - 25.0, ${f(c.rockStart)} + 25.0, hj),
      smoothstep(${f(c.rockSlopeDeg)} - sb, ${f(c.rockSlopeDeg)} + sb, sj)) * smoothstep(-3.0, 0.5, h);
    albedo = mix(albedo, ${rgb(col.rock)}, tlRock);
    amp = mix(amp, ${vec3Of(g.rock)}, tlRock);
    tlCliff = smoothstep(${f(c.cliffSlopeDeg)} - sb, ${f(c.cliffSlopeDeg)} + sb, sj) * smoothstep(-3.0, 0.5, h);
    // 地層の縞: 高さに沿った帯を、大きなうねりでゆがめる
    tlStrataPhase = (h + (detailNoise(p.xz / 55.0) - 0.5) * 2.0 * ${f(c.strata.warp)}
      + (detailNoise(p.xz / 13.0) - 0.5) * ${f(c.strata.warp * 0.4)}) * ${f(strataK)};
    float band = 0.5 + 0.5 * sin(tlStrataPhase) * (0.7 + 0.3 * sin(tlStrataPhase * 2.7 + 1.3));
    vec3 cliffColor = mix(${rgb(col.cliffDark)}, ${rgb(col.cliff)}, mix(0.5, band, ${f(c.strata.contrast)}));
    albedo = mix(albedo, cliffColor, tlCliff);
    amp = mix(amp, ${vec3Of(g.cliff)}, tlCliff);

    // 雪: 山頂付近、北向きの斜面ほど低くまで。急斜面には積もらない
    float horiz = length(n.xz);
    float north = dot(n.xz, vec2(${f(c.snow.north.x)}, ${f(c.snow.north.z)})) / max(horiz, 0.15)
      * smoothstep(0.05, 0.25, horiz);
    float snowLine = ${f(c.snow.start)} - ${f(c.snow.northBias)} * max(north, 0.0)
      - ${f(c.snow.northBias * 0.3)} * min(north, 0.0);
    float wSnow = smoothstep(snowLine - 12.0, snowLine + 12.0, h + bn * ${f(c.snow.noise)})
      * (1.0 - smoothstep(${f(c.snow.maxSlopeDeg)} - 6.0, ${f(c.snow.maxSlopeDeg)} + 4.0, sj));
    albedo = mix(albedo, ${rgb(col.snow)}, wSnow);
    amp = mix(amp, ${vec3Of(g.snow)}, wSnow);
    tlRock *= 1.0 - wSnow;
    tlCliff *= 1.0 - wSnow;

    // 層ごとの粒: 細かい / 粗い / まだら の 3 枚を層の強さで混ぜる（遠くは消す）
    vec3 fade = vec3(
      1.0 - smoothstep(${f(g.fine.fadeStart)}, ${f(g.fine.fadeEnd)}, dist),
      1.0 - smoothstep(${f(g.coarse.fadeStart)}, ${f(g.coarse.fadeEnd)}, dist),
      1.0 - smoothstep(${f(g.mottle.fadeStart)}, ${f(g.mottle.fadeEnd)}, dist));
    amp *= fade;
    float k = 0.0;
    if (amp.x > 0.002) k += detailTriplanar(p / ${f(g.fine.cell)}, w) * 2.0 * amp.x;
    if (amp.y > 0.002) k += detailTriplanar(p / ${f(g.coarse.cell)}, w) * 2.0 * amp.y;
    if (amp.z > 0.002) k += detailTriplanar(p / ${f(g.mottle.cell)}, w) * 2.0 * amp.z;

    // 大きな色むら: 明るさ + 草の色相（黄緑 ⇄ 深緑）。岩・雪では色相を変えない
    float macroFade = 1.0 - smoothstep(${f(c.macro.fadeStart)}, ${f(c.macro.fadeEnd)}, dist);
    float m = (detailNoise(p.xz / ${f(c.macro.cell)}) - 0.5) * 2.0 * macroFade;
    float green = wGrass * (1.0 - max(tlRock, wSnow));
    vec3 hue = mix(vec3(1.0), vec3(1.0 + 0.6 * m, 1.0 + 0.15 * m, 1.0 - 0.5 * m), green * ${f(c.macro.amplitude)});
    return albedo * hue * max(0.0, 1.0 + k + m * ${f(c.macro.amplitude)} * 0.5);
  }

  // 法線の細部（岩・崖）。ワールド座標の法線を返す
  vec3 terrainDetailNormal() {
    vec3 n = normalize(vDetailNormal);
    float s = (tlRock + tlCliff * 0.5) * (1.0 - smoothstep(${f(nm.fadeStart)}, ${f(nm.fadeEnd)}, distance(vDetailPos, cameraPosition)));
    if (s < 0.01) return n;
    vec3 w = n * n;
    w *= w;
    w /= w.x + w.y + w.z;
    vec3 grad = detailTriplanarGrad(vDetailPos / ${f(nm.coarse)}, w) * ${f(nm.coarseDepth / nm.coarse)}
      + detailTriplanarGrad(vDetailPos / ${f(nm.fine)}, w) * ${f(nm.fineDepth / nm.fine)};
    grad *= s;
    // 崖の縞の段差（高さ方向の勾配）
    grad.y += cos(tlStrataPhase) * ${f(nm.strataDepth * strataK)} * tlCliff;
    grad -= n * dot(grad, n);
    return normalize(n - grad);
  }

  // 木の影の代わり（「高」）: 太陽の方へずらした点の森の密度 × まだら。0（影なし）〜strength
  float terrainTreeShade(vec3 sunDir) {
    vec3 p = vDetailPos;
    float len = ${f((v.height.min + v.height.max) * 0.5 * v.shade.length)};
    vec2 q = p.xz + sunDir.xz / max(sunDir.y, 0.25) * len;
    float mottle = smoothstep(0.3, 0.7, detailNoise(q / ${f(v.shade.cell)}));
    float fade = 1.0 - smoothstep(${f(v.shade.fadeEnd * 0.6)}, ${f(v.shade.fadeEnd)}, distance(p, cameraPosition));
    return forestDensity(q) * tlForestZone * mottle * fade * ${f(v.shade.strength)};
  }
`;
}

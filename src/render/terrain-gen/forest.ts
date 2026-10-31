// 森の密度と木の配置（4-6。Three.js 非依存）。
// 密度は整数ハッシュの値ノイズで、同じ式を GLSL（FOREST_GLSL）にも置き、地形の森の層の色と木の位置を揃える
import { createRandom } from '../../core/random';
import { TERRAIN_CONFIG } from '../../data/terrain';
import { VEGETATION_CONFIG } from '../../data/vegetation';
import type { HeightFn } from '../terrain-height';

export type VegetationConfig = typeof VEGETATION_CONFIG;

/** 負の座標でも符号なしで扱えるようにずらす量（GLSL の uint 変換と揃える） */
const CELL_OFFSET = 4096;

/** 整数格子点 → 0〜1 の値（GLSL の forestHash と同じ 32bit 演算） */
export function forestHash(ix: number, iz: number): number {
  let h = (Math.imul(ix + CELL_OFFSET, 1597334677) ^ Math.imul(iz + CELL_OFFSET, -482951495)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), -2048144777) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967295;
}

/** 値ノイズ（0〜1。格子点のハッシュを smoothstep で補間） */
export function forestValue(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = forestHash(ix, iz);
  const b = forestHash(ix + 1, iz);
  const c = forestHash(ix, iz + 1);
  const d = forestHash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 森の密度（0〜1）。高度・傾斜の条件は含まない */
export function forestDensity(
  x: number,
  z: number,
  config: VegetationConfig = VEGETATION_CONFIG,
): number {
  const d = config.density;
  const n =
    forestValue(x / d.cellLarge, z / d.cellLarge) * d.weightLarge +
    forestValue(x / d.cellSmall + 31, z / d.cellSmall + 31) * (1 - d.weightLarge);
  return smoothstep(d.from, d.to, n);
}

/** 森の密度の GLSL（WebGL2。forestHash / forestValue / forestDensity と同じ式） */
export function forestGlsl(config: VegetationConfig = VEGETATION_CONFIG): string {
  const d = config.density;
  const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
  return /* glsl */ `
  float forestHash(ivec2 c) {
    uint h = (uint(c.x + ${CELL_OFFSET}) * 1597334677u) ^ (uint(c.y + ${CELL_OFFSET}) * 3812015801u);
    h = (h ^ (h >> 16u)) * 2246822519u;
    h ^= h >> 13u;
    return float(h) * (1.0 / 4294967295.0);
  }
  float forestValue(vec2 p) {
    vec2 i = floor(p);
    vec2 u = p - i;
    u = u * u * (3.0 - 2.0 * u);
    ivec2 c = ivec2(i);
    float a = forestHash(c);
    float b = forestHash(c + ivec2(1, 0));
    float cc = forestHash(c + ivec2(0, 1));
    float d = forestHash(c + ivec2(1, 1));
    return a + (b - a) * u.x + (cc - a) * u.y + (a - b - cc + d) * u.x * u.y;
  }
  float forestDensity(vec2 xz) {
    float n = forestValue(xz / ${f(d.cellLarge)}) * ${f(d.weightLarge)}
      + forestValue(xz / ${f(d.cellSmall)} + 31.0) * ${f(1 - d.weightLarge)};
    return smoothstep(${f(d.from)}, ${f(d.to)}, n);
  }
`;
}

/** 地形の傾斜（度）。高さ関数の前進差分（間隔 step m） */
export function slopeDeg(
  height: HeightFn,
  x: number,
  z: number,
  step: number,
  h = height(x, z),
): number {
  const gx = (height(x + step, z) - h) / step;
  const gz = (height(x, z + step) - h) / step;
  return (Math.atan(Math.sqrt(gx * gx + gz * gz)) * 180) / Math.PI;
}

/**
 * マップごとの木の撒き方（6-4）: 候補を撒く半径と、密度に掛ける倍率（0〜1）。島は既定（undefined）で 4-9 のまま
 */
export interface TreeArea {
  readonly radius: number;
  readonly mask: (x: number, z: number, h: number) => number;
}

/** 木を置かない四角と、低地で森を減らす設定（MapVegetation と同じ形） */
export interface ForestMaskSpec {
  readonly radius: number;
  readonly lowlandScale: number;
  readonly lowlandFrom: number;
  readonly lowlandFull: number;
  readonly clear: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  } | null;
}

/** 森の密度の倍率（街の四角は 0、低地は lowlandScale から高さで 1 へ）。GLSL の forestMaskAt と同じ式 */
export function forestMask(spec: ForestMaskSpec, x: number, z: number, h: number): number {
  const c = spec.clear;
  if (c && x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return 0;
  if (spec.lowlandScale >= 1) return 1;
  const t = smoothstep(spec.lowlandFrom, spec.lowlandFull, h);
  return spec.lowlandScale + (1 - spec.lowlandScale) * t;
}

/** マップの設定から木の撒き方を作る（既定のままなら undefined = 島と同じ） */
export function treeArea(spec: ForestMaskSpec): TreeArea | undefined {
  if (!spec.clear && spec.lowlandScale >= 1 && spec.radius === VEGETATION_CONFIG.radius)
    return undefined;
  return { radius: spec.radius, mask: (x, z, h) => forestMask(spec, x, z, h) };
}

export interface TreePlacement {
  /** 木の本数 */
  readonly count: number;
  /** 根元の位置（xyz の並び。y は高さ関数の値） */
  readonly positions: Float32Array;
  /** 木ごとの 0〜1 の乱数（大きさ・色のばらつき） */
  readonly seeds: Float32Array;
  /** 木ごとの高さの倍率（4-9。森の縁ほど小さい。treeEdgeScale） */
  readonly scales: Float32Array;
  /**
   * 束（4-7。遠景のビルボード 1 枚 = 束 1 つ）。束にしない配置では木 1 本 = 束 1 つ。
   * positions は束の木の根元の平均、spreads は束の中心から最も遠い木までの水平距離（m）、sizes は本数
   */
  readonly clumps: {
    readonly count: number;
    readonly positions: Float32Array;
    readonly spreads: Float32Array;
    readonly sizes: Uint8Array;
    readonly seeds: Float32Array;
    readonly scales: Float32Array;
  };
}

/** 森の縁の高さの倍率（4-9）: 密度 0 で edge.heightMin、edge.densityFull 以上で 1 */
export function treeEdgeScale(
  density: number,
  config: VegetationConfig = VEGETATION_CONFIG,
): number {
  const e = config.edge;
  return e.heightMin + (1 - e.heightMin) * smoothstep(0, e.densityFull, density);
}

/** 束の中の j 本目の木の 0〜1 の値（候補の乱数 variation から決定的に。salt で用途を分ける） */
function clumpHash(variation: number, j: number, salt: number): number {
  return forestHash(Math.floor(variation * 1048576), j * 16 + salt);
}

/**
 * 森の層（高度 minHeight〜maxHeight・傾斜 maxSlopeDeg 以下）に、密度 ^ edge.acceptPower の確率で木を count 本まで撒く。
 * clumped（4-7。画質「中」以上）なら 1 候補ごとに clump.min〜clump.max 本の束にする（束の木は中心から
 * clump.spacing m ほど離して輪に並べ、高度の範囲の外に出た木は置かない）。
 * 乱数はシード付きで、同じ count なら毎回同じ。少ない count は多い count の先頭と同じ並び
 */
export function placeTrees(
  height: HeightFn,
  count: number,
  config: VegetationConfig = VEGETATION_CONFIG,
  seed = TERRAIN_CONFIG.seed + config.seedOffset,
  clumped = false,
  area?: TreeArea,
): TreePlacement {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const scales = new Float32Array(count);
  const clumpPositions = new Float32Array(count * 3);
  const spreads = new Float32Array(count);
  const sizes = new Uint8Array(count);
  const clumpSeeds = new Float32Array(count);
  const clumpScales = new Float32Array(count);
  const r = area?.radius ?? config.radius;
  const cl = config.clump;
  const maxAttempts = count * config.maxAttemptsPerTree;
  let placed = 0;
  let clumps = 0;
  for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
    // 乱数は 1 候補につき必ず 4 回引く（途中で棄却しても後の並びが変わらない）
    const x = (random() * 2 - 1) * r;
    const z = (random() * 2 - 1) * r;
    const accept = random();
    const variation = random();
    if (x * x + z * z > r * r) continue;
    // 4-9: 置く確率は 密度 ^ acceptPower（縁ほど疎に）
    let density = forestDensity(x, z, config);
    if (accept >= density ** config.edge.acceptPower) continue;
    const h = height(x, z);
    if (h < config.minHeight || h > config.maxHeight) continue;
    // 6-4: マップの倍率（島は area なしで素通り。並びを変えないよう乱数を引いた後で棄却する）
    if (area) {
      const m = area.mask(x, z, h);
      if (m <= 0 || accept >= (density * m) ** config.edge.acceptPower) continue;
      density *= m;
    }
    if (slopeDeg(height, x, z, config.slopeStep, h) > config.maxSlopeDeg) continue;
    const members = clumped
      ? cl.min + Math.floor(clumpHash(variation, 0, 0) * (cl.max - cl.min + 1))
      : 1;
    const turn = clumpHash(variation, 0, 1) * Math.PI * 2;
    const first = placed;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let j = 0; j < members && placed < count; j++) {
      let tx = x;
      let tz = z;
      let th = h;
      if (j > 0) {
        // 1 本目は候補の位置、残りはそのまわりの輪（角度は等間隔 + ずれ）
        const angle =
          turn + (j / (members - 1)) * Math.PI * 2 + (clumpHash(variation, j, 2) - 0.5) * 0.8;
        const d = cl.spacing.min + (cl.spacing.max - cl.spacing.min) * clumpHash(variation, j, 3);
        tx = x + Math.cos(angle) * d;
        tz = z + Math.sin(angle) * d;
        th = height(tx, tz);
        if (th < config.minHeight || th > config.maxHeight) continue;
      }
      positions[placed * 3] = tx;
      positions[placed * 3 + 1] = th;
      positions[placed * 3 + 2] = tz;
      seeds[placed] = j === 0 ? variation : clumpHash(variation, j, 4);
      scales[placed] = treeEdgeScale(density, config);
      sx += tx;
      sy += th;
      sz += tz;
      placed++;
    }
    const n = placed - first;
    const cx = sx / n;
    const cz = sz / n;
    let spread = 0;
    for (let t = first; t < placed; t++) {
      spread = Math.max(
        spread,
        Math.hypot((positions[t * 3] ?? 0) - cx, (positions[t * 3 + 2] ?? 0) - cz),
      );
    }
    clumpPositions.set([cx, sy / n, cz], clumps * 3);
    spreads[clumps] = spread;
    sizes[clumps] = n;
    clumpSeeds[clumps] = variation;
    clumpScales[clumps] = treeEdgeScale(density, config);
    clumps++;
  }
  return {
    count: placed,
    positions: placed < count ? positions.slice(0, placed * 3) : positions,
    seeds: placed < count ? seeds.slice(0, placed) : seeds,
    scales: placed < count ? scales.slice(0, placed) : scales,
    clumps: {
      count: clumps,
      positions: clumpPositions.slice(0, clumps * 3),
      spreads: spreads.slice(0, clumps),
      sizes: sizes.slice(0, clumps),
      seeds: clumpSeeds.slice(0, clumps),
      scales: clumpScales.slice(0, clumps),
    },
  };
}

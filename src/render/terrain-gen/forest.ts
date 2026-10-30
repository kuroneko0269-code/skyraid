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

export interface TreePlacement {
  readonly count: number;
  /** 根元の位置（xyz の並び。y は高さ関数の値） */
  readonly positions: Float32Array;
  /** 木ごとの 0〜1 の乱数（大きさ・色のばらつき） */
  readonly seeds: Float32Array;
}

/**
 * 森の層（高度 minHeight〜maxHeight・傾斜 maxSlopeDeg 以下）に、密度に比例して木を count 本まで撒く。
 * 乱数はシード付きで、同じ count なら毎回同じ。少ない count は多い count の先頭と同じ並び
 */
export function placeTrees(
  height: HeightFn,
  count: number,
  config: VegetationConfig = VEGETATION_CONFIG,
  seed = TERRAIN_CONFIG.seed + config.seedOffset,
): TreePlacement {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const r = config.radius;
  const maxAttempts = count * config.maxAttemptsPerTree;
  let placed = 0;
  for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
    // 乱数は 1 候補につき必ず 4 回引く（途中で棄却しても後の並びが変わらない）
    const x = (random() * 2 - 1) * r;
    const z = (random() * 2 - 1) * r;
    const accept = random();
    const variation = random();
    if (x * x + z * z > r * r) continue;
    if (accept >= forestDensity(x, z, config)) continue;
    const h = height(x, z);
    if (h < config.minHeight || h > config.maxHeight) continue;
    if (slopeDeg(height, x, z, config.slopeStep, h) > config.maxSlopeDeg) continue;
    positions[placed * 3] = x;
    positions[placed * 3 + 1] = h;
    positions[placed * 3 + 2] = z;
    seeds[placed] = variation;
    placed++;
  }
  return {
    count: placed,
    positions: placed < count ? positions.slice(0, placed * 3) : positions,
    seeds: placed < count ? seeds.slice(0, placed) : seeds,
  };
}

import { BufferAttribute, BufferGeometry, Color } from 'three';
import { TERRAIN_CONFIG } from '../data/terrain';
import { VEGETATION_CONFIG } from '../data/vegetation';
import { forestDensity } from './terrain-gen/forest';
import type { HeightFn, TerrainConfig } from './terrain-height';

export interface ChunkRect {
  minX: number;
  minZ: number;
  size: number;
}

type Rgb = [number, number, number];

/** 頂点カラー（sRGB の 16 進）を線形 RGB にしたもの */
function linear(hex: number): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 整数格子の値から 0〜1 の擬似乱数（頂点ごとの色のばらつき用。LOD が変わっても同じ点は同じ値） */
function hash2(x: number, z: number): number {
  const h = Math.imul(Math.round(x) | 0, 374761393) ^ Math.imul(Math.round(z) | 0, 668265263);
  const m = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((m ^ (m >>> 16)) >>> 0) / 4294967296;
}

const COS_FOREST_SLOPE = Math.cos((VEGETATION_CONFIG.maxSlopeDeg * Math.PI) / 180);

/** 森の層（木を置く高度・傾斜の範囲）の重み 0〜1 */
function forestZone(h: number, ny: number): number {
  const v = VEGETATION_CONFIG;
  return (
    smoothstep(v.minHeight, v.minHeight + 15, h) *
    (1 - smoothstep(v.maxHeight - 15, v.maxHeight, h)) *
    smoothstep(COS_FOREST_SLOPE - 0.02, COS_FOREST_SLOPE + 0.02, ny)
  );
}

/** 高さと傾きから地表の色を決める（画質「低」の頂点カラー） */
export class TerrainPalette {
  private readonly seabed: Rgb;
  private readonly sand: Rgb;
  private readonly grass: Rgb;
  private readonly forest: Rgb;
  private readonly rock: Rgb;
  private readonly snow: Rgb;

  constructor(private readonly colors: TerrainConfig['colors'] = TERRAIN_CONFIG.colors) {
    this.seabed = linear(colors.seabed);
    this.sand = linear(colors.sand);
    this.grass = linear(colors.grass);
    this.forest = linear(colors.forest);
    this.rock = linear(colors.rock);
    this.snow = linear(colors.snow);
  }

  /** out[offset..offset+2] に線形 RGB を書く */
  write(out: Float32Array, offset: number, x: number, z: number, h: number, ny: number): void {
    const c = this.colors;
    const b = c.blend;
    const mixes: [Rgb, number][] = [
      [this.sand, smoothstep(-8, -1, h)],
      [this.grass, smoothstep(c.sandTop, c.sandTop + b * 0.25, h)],
      // 森: 木の配置と同じ密度 × 森の層（高度・傾斜。4-6）
      [this.forest, forestDensity(x, z) * forestZone(h, ny)],
      [
        this.rock,
        Math.max(
          smoothstep(c.rockStart - b, c.rockStart + b, h),
          // 砂浜より上の急斜面は岩肌
          (1 - smoothstep(c.steepNormalY - 0.08, c.steepNormalY + 0.04, ny)) *
            smoothstep(c.sandTop, c.sandTop + b, h),
        ),
      ],
      // 雪は急斜面には積もらない
      [this.snow, smoothstep(c.snowStart - b, c.snowStart + b, h) * smoothstep(0.55, 0.75, ny)],
    ];
    let [r, g, bl] = this.seabed;
    for (const [col, w] of mixes) {
      r += (col[0] - r) * w;
      g += (col[1] - g) * w;
      bl += (col[2] - bl) * w;
    }
    const jitter = 1 + (hash2(x, z) * 2 - 1) * c.jitter;
    out[offset] = r * jitter;
    out[offset + 1] = g * jitter;
    out[offset + 2] = bl * jitter;
  }
}

export interface ChunkGeometry {
  readonly geometry: BufferGeometry;
  /** position 属性の配列（xyz の並び） */
  readonly positions: Float32Array;
  readonly segments: number;
  /** 頂点の元の高さ（縁の継ぎ合わせで書き換えた高さを戻すため） */
  readonly baseHeights: Float32Array;
  /** 縁ごとに今の継ぎ合わせの間隔（1 = 元のまま） */
  readonly edgeSteps: number[];
}

/**
 * チャンク 1 枚の地形ジオメトリ（ワールド座標）。一辺 segments 分割の格子で、法線は高さの中心差分。
 * LOD の違う隣とのひび割れは terrain-lod.ts の stitchEdge で縁の高さを寄せて塞ぐ
 */
export function buildChunkGeometry(
  rect: ChunkRect,
  segments: number,
  height: HeightFn,
  palette: TerrainPalette,
): ChunkGeometry {
  const n = segments;
  const step = rect.size / n;
  const row = n + 1;
  // 法線の中心差分のため、周囲に 1 列ずつ余分に高さを取る
  const sampleRow = n + 3;
  const samples = new Float32Array(sampleRow * sampleRow);
  for (let j = 0; j < sampleRow; j++) {
    for (let i = 0; i < sampleRow; i++) {
      samples[j * sampleRow + i] = height(rect.minX + (i - 1) * step, rect.minZ + (j - 1) * step);
    }
  }
  const sample = (i: number, j: number): number => samples[(j + 1) * sampleRow + i + 1] ?? 0;

  const vertexCount = row * row;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const baseHeights = new Float32Array(vertexCount);

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = j * row + i;
      const x = rect.minX + i * step;
      const z = rect.minZ + j * step;
      const h = sample(i, j);
      baseHeights[v] = h;
      positions[v * 3] = x;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = z;
      const nx = sample(i - 1, j) - sample(i + 1, j);
      const nz = sample(i, j - 1) - sample(i, j + 1);
      const ny = 2 * step;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normals[v * 3] = nx / len;
      normals[v * 3 + 1] = ny / len;
      normals[v * 3 + 2] = nz / len;
      palette.write(colors, v * 3, x, z, h, ny / len);
    }
  }

  // 上から見て反時計回り（表が +Y）
  const indices = new Uint32Array(6 * n * n);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.set([a, c, b, c, d, b], k);
      k += 6;
    }
  }

  const geometry = new BufferGeometry();
  // BufferAttribute は配列をコピーしないので、positions を書き換えれば縁の継ぎ合わせが効く
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return { geometry, positions, segments, baseHeights, edgeSteps: [1, 1, 1, 1] };
}

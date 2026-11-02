// デカールのマスク（7-3。Three.js・DOM 非依存）: decal-shapes.ts の多角形を偶奇の塗りで走査線ラスタライズする
// （縦 4 本の副走査線 × 横は端の割合でアンチエイリアス）。ブラウザの SVG の画像化（非同期）を使わず、同じ図形を
// その場で同期に描くので、テクスチャの生成を 1 フレームで終えられ、Vitest でも確かめられる。図形ごとにキャッシュする
import type { DecalShape } from './decal-shapes';

export interface DecalMask {
  readonly width: number;
  readonly height: number;
  /** 被覆率 0〜1（行は上から） */
  readonly data: Float32Array;
  readonly aspect: number;
}

/** 高さ 1 あたりの画素数 */
const RESOLUTION = 128;
const SUB = 4;

export function rasterizeShape(shape: DecalShape, resolution = RESOLUTION): DecalMask {
  const height = resolution;
  const width = Math.max(1, Math.round(resolution * shape.aspect));
  const data = new Float32Array(width * height);
  const xs: number[] = [];
  const half = shape.aspect / 2;
  for (let j = 0; j < height; j++) {
    for (let k = 0; k < SUB; k++) {
      const y = 0.5 - (j + (k + 0.5) / SUB) / height;
      xs.length = 0;
      for (const ring of shape.rings) {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const x0 = ring[i * 2] ?? 0;
          const y0 = ring[i * 2 + 1] ?? 0;
          const i1 = (i + 1) % n;
          const x1 = ring[i1 * 2] ?? 0;
          const y1 = ring[i1 * 2 + 1] ?? 0;
          if (y0 <= y === y1 <= y) continue;
          xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = ((xs[i] ?? 0) + half) * resolution;
        const b = ((xs[i + 1] ?? 0) + half) * resolution;
        span(data, j * width, width, a, b, 1 / SUB);
      }
    }
  }
  return { width, height, data, aspect: shape.aspect };
}

/** 行の a〜b（画素単位の実数）を weight だけ塗る。端の画素は覆った割合で */
function span(
  data: Float32Array,
  row: number,
  width: number,
  a: number,
  b: number,
  weight: number,
): void {
  const lo = Math.max(0, a);
  const hi = Math.min(width, b);
  if (hi <= lo) return;
  const i0 = Math.floor(lo);
  const i1 = Math.floor(hi);
  if (i0 === i1) {
    data[row + i0] = (data[row + i0] ?? 0) + (hi - lo) * weight;
    return;
  }
  data[row + i0] = (data[row + i0] ?? 0) + (i0 + 1 - lo) * weight;
  for (let i = i0 + 1; i < i1; i++) data[row + i] = (data[row + i] ?? 0) + weight;
  if (i1 < width) data[row + i1] = (data[row + i1] ?? 0) + (hi - i1) * weight;
}

const cache = new Map<string, DecalMask>();

/** キャッシュつきのマスク（key は図形を決める文字列: デカールの id・機体番号） */
export function maskFor(key: string, make: () => DecalShape): DecalMask {
  let m = cache.get(key);
  if (!m) {
    m = rasterizeShape(make());
    cache.set(key, m);
  }
  return m;
}

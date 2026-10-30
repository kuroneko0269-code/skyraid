// 水深（4-2。Three.js 非依存）。地形の高さ関数から格子に焼き、海面シェーダーでは浮動小数点の
// テクスチャ（線形補間）として読む。sampleDepthField は GPU の線形補間と同じ位置関係で補間する
import type { HeightFn } from './terrain-height';

/** 地形の高さ h の点の水深（m）。海面より上（陸）は負 */
export function waterDepth(terrainHeight: number, seaLevel = 0): number {
  return seaLevel - terrainHeight;
}

export interface DepthField {
  /** 格子が覆う一辺（m。原点中心） */
  readonly size: number;
  /** 一辺の格子点の数 */
  readonly resolution: number;
  /** 水深（m）。添字 = i + j × resolution（i が x、j が z） */
  readonly data: Float32Array;
}

/**
 * 原点中心・一辺 size の範囲を resolution × resolution に分け、各マスの中心の水深を計算する
 * （テクスチャの画素の中心と同じ位置）
 */
export function bakeDepthField(
  height: HeightFn,
  size: number,
  resolution: number,
  seaLevel = 0,
): DepthField {
  const data = new Float32Array(resolution * resolution);
  const cell = size / resolution;
  const half = size / 2;
  for (let j = 0; j < resolution; j++) {
    const z = -half + (j + 0.5) * cell;
    for (let i = 0; i < resolution; i++) {
      const x = -half + (i + 0.5) * cell;
      data[i + j * resolution] = waterDepth(height(x, z), seaLevel);
    }
  }
  return { size, resolution, data };
}

/** 格子の水深を (x, z) で双線形補間する。範囲外は端の値（テクスチャの ClampToEdge と同じ） */
export function sampleDepthField(field: DepthField, x: number, z: number): number {
  const n = field.resolution;
  const fx = ((x + field.size / 2) / field.size) * n - 0.5;
  const fz = ((z + field.size / 2) / field.size) * n - 0.5;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const at = (i: number, j: number): number => {
    const ci = Math.min(n - 1, Math.max(0, i));
    const cj = Math.min(n - 1, Math.max(0, j));
    return field.data[ci + cj * n] ?? 0;
  };
  const a = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * tx;
  const b = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * tx;
  return a + (b - a) * tz;
}

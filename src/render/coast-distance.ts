// 海岸線からの距離（4-8。Three.js 非依存）。4-2c の水深の格子（ocean-depth.ts）から、各マスの中心と
// 海岸線（水深 0 の線）の距離を焼く。砂浜の幅を高さではなく海岸線からの距離で決めるのに使う
import type { DepthField } from './ocean-depth';

/**
 * 符号付きの海岸線までの距離（m。陸が正、海が負）。添字・マスの位置は depth と同じ。
 * 隣り合うマスで水深の符号が変わる所を線形補間した点を種にし、8 近傍の 2 方向の走査で
 * 「いちばん近い種の位置」を伝える（8SSEDT と同じ方式。誤差はマスの数 % 程度）。
 * 種が 1 つもない（陸も海岸もない）ときは全部 -farValue
 */
export function bakeCoastDistance(depth: DepthField, farValue = 1e4): Float32Array {
  const n = depth.resolution;
  const cell = depth.size / n;
  const d = depth.data;
  const count = n * n;
  // いちばん近い種の位置（マス単位。マス (i, j) の中心が (i, j)）と、その距離の 2 乗
  const seedX = new Float32Array(count);
  const seedY = new Float32Array(count);
  const dist2 = new Float32Array(count).fill(Infinity);

  const offer = (k: number, i: number, j: number, sx: number, sy: number): void => {
    const dx = sx - i;
    const dy = sy - j;
    const q = dx * dx + dy * dy;
    if (q < (dist2[k] ?? Infinity)) {
      dist2[k] = q;
      seedX[k] = sx;
      seedY[k] = sy;
    }
  };

  // 種: 右・下の隣と水深の符号が違えば、水深 0 の位置（線形補間）を両方のマスに
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = i + j * n;
      const a = d[k] ?? 0;
      if (i + 1 < n) {
        const b = d[k + 1] ?? 0;
        if (a < 0 !== b < 0) {
          const t = a / (a - b);
          offer(k, i, j, i + t, j);
          offer(k + 1, i + 1, j, i + t, j);
        }
      }
      if (j + 1 < n) {
        const b = d[k + n] ?? 0;
        if (a < 0 !== b < 0) {
          const t = a / (a - b);
          offer(k, i, j, i, j + t);
          offer(k + n, i, j + 1, i, j + t);
        }
      }
    }
  }

  // 隣のマス (ni, nj) の種を (i, j) に試す
  const pull = (i: number, j: number, ni: number, nj: number): void => {
    if (ni < 0 || nj < 0 || ni >= n || nj >= n) return;
    const m = ni + nj * n;
    if (dist2[m] === Infinity) return;
    offer(i + j * n, i, j, seedX[m] ?? 0, seedY[m] ?? 0);
  };
  for (let iteration = 0; iteration < 2; iteration++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        pull(i, j, i - 1, j);
        pull(i, j, i - 1, j - 1);
        pull(i, j, i, j - 1);
        pull(i, j, i + 1, j - 1);
      }
      for (let i = n - 1; i >= 0; i--) pull(i, j, i + 1, j);
    }
    for (let j = n - 1; j >= 0; j--) {
      for (let i = n - 1; i >= 0; i--) {
        pull(i, j, i + 1, j);
        pull(i, j, i + 1, j + 1);
        pull(i, j, i, j + 1);
        pull(i, j, i - 1, j + 1);
      }
      for (let i = 0; i < n; i++) pull(i, j, i - 1, j);
    }
  }

  const out = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    const q = dist2[k] ?? Infinity;
    const dist = q === Infinity ? farValue : Math.min(Math.sqrt(q) * cell, farValue);
    out[k] = (d[k] ?? 0) < 0 ? dist : -dist;
  }
  return out;
}

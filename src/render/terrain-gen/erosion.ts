// 生成時の水力浸食（4-6。Three.js 非依存）。粒子（雨粒）ベース:
// 雨粒をランダムな場所に落とし、斜面を下りながら速さと水量に応じて土を削って運び、
// 運べる量を超えたら（平らな所・上り坂で）落とす。尾根が鋭く、谷に溝、山裾に扇状の堆積ができる。
// 乱数はシード付きなので同じ入力・同じシードなら毎回同じ結果になる

import { createRandom } from '../../core/random';

export interface ErosionParams {
  /** 落とす雨粒の数 */
  readonly droplets: number;
  /** 1 粒が進む最大の歩数（1 歩 = 格子 1 マス） */
  readonly maxSteps: number;
  /** 慣性（0 = 常に最急勾配へ、1 = 向きを変えない） */
  readonly inertia: number;
  /** 運べる土の量の係数（下り坂の勾配 × 速さ × 水量 に掛ける） */
  readonly capacity: number;
  /** 平らな所でも最低これだけは運べる（溝が途切れないように） */
  readonly minCapacity: number;
  /** 運べる余裕のうち 1 歩で削る割合 */
  readonly erodeRate: number;
  /** 運べる量を超えた分のうち 1 歩で落とす割合 */
  readonly depositRate: number;
  /** 1 歩ごとに蒸発する水の割合 */
  readonly evaporate: number;
  /** 下り坂で速さが増える係数 */
  readonly gravity: number;
  /** 削るときの筆の半径（マス）。1 で 3×3、0 で 4 隅だけ */
  readonly radius: number;
  /** 計算の前に高さをこの値で割って 0〜1 程度にする（パラメータを解像度・高さに依らなくする） */
  readonly heightScale: number;
}

export interface ErosionGrid {
  /** 一辺の格子点の数 */
  readonly resolution: number;
  /** 高さ。添字 = i + j × resolution。結果で上書きする */
  readonly heights: Float32Array;
  /** 格子点ごとに浸食を効かせる割合（0〜1）。0 の所は削りも堆積もしない（海岸線を動かさない） */
  readonly mask: Float32Array;
  /** 格子点ごとの堆積の倍率（省略時 1）。風下の浜で大きく、風上の崖で小さく */
  readonly depositScale?: Float32Array;
}

/**
 * grid.heights をその場で浸食する。雨粒は mask > 0 の格子点からだけ落とす（海の上は落とさない）
 */
export function erode(grid: ErosionGrid, params: ErosionParams, seed: number): void {
  const n = grid.resolution;
  const { heights, mask } = grid;
  const depositScale = grid.depositScale ?? new Float32Array(heights.length).fill(1);
  const scale = params.heightScale;
  const map = new Float64Array(heights.length);
  for (let k = 0; k < map.length; k++) map[k] = (heights[k] ?? 0) / scale;

  // 雨粒を落とす候補（陸の格子点）
  const land: number[] = [];
  for (let j = 1; j < n - 2; j++) {
    for (let i = 1; i < n - 2; i++) if ((mask[i + j * n] ?? 0) > 0) land.push(i + j * n);
  }
  if (land.length === 0) return;

  // 筆の重み（半径内の格子点へ、中心からの距離で減らして配る）
  const r = params.radius;
  const brushDi: number[] = [];
  const brushDj: number[] = [];
  const brushW: number[] = [];
  let wsum = 0;
  for (let dj = -r; dj <= r + 1; dj++) {
    for (let di = -r; di <= r + 1; di++) {
      // 0.5 マスずれた中心（4 隅の真ん中）からの距離
      const d = Math.hypot(di - 0.5, dj - 0.5);
      const w = Math.max(0, r + 1 - d);
      if (w <= 0) continue;
      brushDi.push(di);
      brushDj.push(dj);
      brushW.push(w);
      wsum += w;
    }
  }
  for (let b = 0; b < brushW.length; b++) brushW[b] = (brushW[b] ?? 0) / wsum;

  const random = createRandom(seed);
  const { inertia, capacity, minCapacity, erodeRate, depositRate, evaporate, gravity } = params;
  const hi = n - 2 - r;
  const lo = r;

  for (let drop = 0; drop < params.droplets; drop++) {
    const start = land[Math.floor(random() * land.length)] ?? 0;
    let x = (start % n) + random();
    let y = Math.floor(start / n) + random();
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < params.maxSteps; step++) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const k = ix + iy * n;
      // 海（効きが 0 の所）まで流れたら、運んでいた土ごと海へ消える
      if (mask[k] === 0) break;
      const h00 = map[k] ?? 0;
      const h10 = map[k + 1] ?? 0;
      const h01 = map[k + n] ?? 0;
      const h11 = map[k + n + 1] ?? 0;
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const h =
        h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < lo || ny < lo || nx >= hi || ny >= hi) break;

      const jx = Math.floor(nx);
      const jy = Math.floor(ny);
      const ex = nx - jx;
      const ey = ny - jy;
      const m = jx + jy * n;
      const nh =
        (map[m] ?? 0) * (1 - ex) * (1 - ey) +
        (map[m + 1] ?? 0) * ex * (1 - ey) +
        (map[m + n] ?? 0) * (1 - ex) * ey +
        (map[m + n + 1] ?? 0) * ex * ey;
      const dh = nh - h;
      const cap = Math.max(-dh * speed * water * capacity, minCapacity);

      if (sediment > cap || dh > 0) {
        // 上り坂は穴を埋める分だけ、そうでなければ超えた分の一部を落とす（4 隅に双線形で配る）
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositRate;
        sediment -= amount;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const s00 = (mask[k] ?? 0) * (depositScale[k] ?? 1);
        const s10 = (mask[k + 1] ?? 0) * (depositScale[k + 1] ?? 1);
        const s01 = (mask[k + n] ?? 0) * (depositScale[k + n] ?? 1);
        const s11 = (mask[k + n + 1] ?? 0) * (depositScale[k + n + 1] ?? 1);
        map[k] = h00 + amount * w00 * s00;
        map[k + 1] = h10 + amount * w10 * s10;
        map[k + n] = h01 + amount * w01 * s01;
        map[k + n + 1] = h11 + amount * w11 * s11;
      } else {
        // 削る（運べる余裕の一部。ただし下り坂の段差より深くは掘らない）を筆で周りに配る
        const amount = Math.min((cap - sediment) * erodeRate, -dh);
        let taken = 0;
        for (let b = 0; b < brushW.length; b++) {
          const c = ix + (brushDi[b] ?? 0) + (iy + (brushDj[b] ?? 0)) * n;
          const want = amount * (brushW[b] ?? 0) * (mask[c] ?? 0);
          const cur = map[c] ?? 0;
          const d = Math.min(want, Math.max(0, cur));
          map[c] = cur - d;
          taken += d;
        }
        sediment += taken;
      }

      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
      x = nx;
      y = ny;
    }
  }

  for (let k = 0; k < map.length; k++) heights[k] = (map[k] ?? 0) * scale;
}

// 雲の 3D ノイズと密度関数（4-2。Three.js 非依存）。ノイズは起動時に作るタイル状の格子で、
// GPU には 3D テクスチャ（R8、線形補間・繰り返し）として渡す。密度の式は cloud-glsl.ts と同じ。
// CPU 側はテストと、カメラの位置の雲の濃さ（雲の中の霧）に使う
import { CLOUD_CONFIG } from '../data/clouds';
import { createRandom } from '../core/random';

export interface CloudNoise {
  /** 一辺の格子点の数 */
  readonly size: number;
  /** 0〜255。添字 = x + y × size + z × size²（3D テクスチャと同じ並び） */
  readonly data: Uint8Array;
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** 周期 period の格子の値ノイズ（0〜1）。座標は周期の単位（0〜period で 1 周） */
function valueNoise(table: Float32Array, period: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const tx = s(x - x0);
  const ty = s(y - y0);
  const tz = s(z - z0);
  const v = (i: number, j: number, k: number): number =>
    table[wrap(i, period) + wrap(j, period) * period + wrap(k, period) * period * period] ?? 0;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const a = lerp(
    lerp(v(x0, y0, z0), v(x0 + 1, y0, z0), tx),
    lerp(v(x0, y0 + 1, z0), v(x0 + 1, y0 + 1, z0), tx),
    ty,
  );
  const b = lerp(
    lerp(v(x0, y0, z0 + 1), v(x0 + 1, y0, z0 + 1), tx),
    lerp(v(x0, y0 + 1, z0 + 1), v(x0 + 1, y0 + 1, z0 + 1), tx),
    ty,
  );
  return lerp(a, b, tz);
}

/** 周期 period のセルに 1 つずつ特徴点を置いた Worley ノイズの、反転した最近距離（1 が点の上、0〜1） */
function worleyNoise(
  points: Float32Array,
  period: number,
  x: number,
  y: number,
  z: number,
): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  const p2 = period * period;
  let best = 9;
  for (let k = -1; k <= 1; k++) {
    const kz = (wrap(cz + k, period) * p2) | 0;
    const dz0 = cz + k - z;
    for (let j = -1; j <= 1; j++) {
      const jy = kz + wrap(cy + j, period) * period;
      const dy0 = cy + j - y;
      for (let i = -1; i <= 1; i++) {
        const c = 3 * (jy + wrap(cx + i, period));
        const dx = cx + i - x + (points[c] ?? 0);
        const dy = dy0 + (points[c + 1] ?? 0);
        const dz = dz0 + (points[c + 2] ?? 0);
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
    }
  }
  return Math.max(0, 1 - Math.sqrt(best));
}

/**
 * タイル状（端がつながる）の 3D ノイズを作る。Worley（もこもこした塊）と値ノイズ（ゆらぎ）の fBm を
 * 6:4 で混ぜ、全体を 0〜1 に正規化する（Perlin-Worley に近い積雲の形）
 */
export function createCloudNoise(
  size: number = CLOUD_CONFIG.noise.size,
  seed: number = CLOUD_CONFIG.noise.seed,
): CloudNoise {
  const random = createRandom(seed);
  const periods = [3, 6, 12];
  const values = periods.map((p) => Float32Array.from({ length: p * p * p }, () => random()));
  const points = periods.map((p) => Float32Array.from({ length: p * p * p * 3 }, () => random()));
  const raw = new Float32Array(size * size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let w = 0;
        let v = 0;
        let amp = 1;
        let norm = 0;
        for (let o = 0; o < periods.length; o++) {
          const p = periods[o] ?? 1;
          const f = p / size;
          w += worleyNoise(points[o] ?? new Float32Array(), p, x * f, y * f, z * f) * amp;
          v += valueNoise(values[o] ?? new Float32Array(), p, x * f, y * f, z * f) * amp;
          norm += amp;
          amp *= 0.5;
        }
        const n = (0.6 * w + 0.4 * v) / norm;
        raw[x + y * size + z * size * size] = n;
        min = Math.min(min, n);
        max = Math.max(max, n);
      }
    }
  }
  const data = new Uint8Array(raw.length);
  const range = max - min || 1;
  for (let i = 0; i < raw.length; i++) data[i] = Math.round((((raw[i] ?? 0) - min) / range) * 255);
  return { size, data };
}

/**
 * ノイズを (u, v, w)（1 で 1 周）で三線形補間して読む（0〜1）。GPU の 3D テクスチャ
 * （LinearFilter・RepeatWrapping、画素の中心が (i + 0.5) / size）と同じ
 */
export function sampleCloudNoise(noise: CloudNoise, u: number, v: number, w: number): number {
  const n = noise.size;
  const fx = u * n - 0.5;
  const fy = v * n - 0.5;
  const fz = w * n - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;
  const d = noise.data;
  const at = (i: number, j: number, k: number): number =>
    (d[wrap(i, n) + wrap(j, n) * n + wrap(k, n) * n * n] ?? 0) / 255;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const a = lerp(
    lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), tx),
    lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx),
    ty,
  );
  const b = lerp(
    lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx),
    lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx),
    ty,
  );
  return lerp(a, b, tz);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 層の中の高さの割合 hf（下端 0・上端 1）での形の重み。底は平らに（すぐ立ち上がる）、
 * 上は丸く細る（積雲）。層の外は 0
 */
export function cloudHeightProfile(hf: number): number {
  if (hf <= 0 || hf >= 1) return 0;
  return smoothstep(0, 0.1, hf) * (1 - smoothstep(0.4, 1, hf));
}

/**
 * 密度（0〜1。消散係数は × CLOUD_CONFIG.extinction）。shape・detail はノイズの値（0〜1）、
 * coverage は被覆率。形 × 高さの重みのうち上位 coverage の割合だけを雲にし、細部のノイズで縁を削る。
 * coverage を上げると、どの点でも密度は下がらない（単調に増える）
 */
export function cloudDensity(
  shape: number,
  detail: number,
  hf: number,
  coverage: number,
  detailWeight: number = CLOUD_CONFIG.noise.detailWeight,
): number {
  const c = Math.min(1, Math.max(1e-3, coverage));
  const base = shape * cloudHeightProfile(hf);
  const d = (base - (1 - c)) / c;
  if (d <= 0) return 0;
  return Math.min(1, Math.max(0, d - detailWeight * detail * (1 - d)));
}

export interface CloudLayer {
  readonly base: number;
  readonly top: number;
  readonly coverage: number;
}

/**
 * ワールド座標 (x, y, z) の雲の密度。offsetX / offsetZ は風で流れた量（m）。
 * GPU（cloud-glsl.ts の cloudDensityAt）と同じ式
 */
export function cloudDensityAt(
  noise: CloudNoise,
  x: number,
  y: number,
  z: number,
  offsetX: number,
  offsetZ: number,
  layer: CloudLayer = CLOUD_CONFIG,
): number {
  const hf = (y - layer.base) / (layer.top - layer.base);
  if (hf <= 0 || hf >= 1) return 0;
  const n = CLOUD_CONFIG.noise;
  const qx = x - offsetX;
  const qz = z - offsetZ;
  const weather = sampleCloudNoise(noise, qx / n.weatherScale, 0.5, qz / n.weatherScale);
  const coverage = layer.coverage + (weather - 0.5) * n.weatherAmount;
  const shape = sampleCloudNoise(noise, qx / n.shapeScale, y / n.shapeScale, qz / n.shapeScale);
  const detail = sampleCloudNoise(
    noise,
    qx / n.detailScale + 0.37,
    y / n.detailScale + 0.37,
    qz / n.detailScale + 0.37,
  );
  return cloudDensity(shape, detail, hf, coverage, n.detailWeight);
}

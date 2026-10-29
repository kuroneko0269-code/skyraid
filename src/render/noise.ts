// シード付き 2D simplex ノイズと fBm（Three.js 非依存）。
// Stefan Gustavson の simplex ノイズの実装方針に沿った自前実装

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 12 方向の勾配（3D 版の勾配の xy 成分）
const GRAD_X = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];

/** 32bit のシードから [0, 1) の乱数列を作る（mulberry32） */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimplexNoise2D {
  // 512 要素（256 を 2 回）にして & 255 を減らす
  private readonly perm = new Uint8Array(512);
  private readonly permMod12 = new Uint8Array(512);

  constructor(seed: number) {
    const random = createRandom(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher–Yates でシャッフル
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const tmp = p[i] ?? 0;
      p[i] = p[j] ?? 0;
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      const v = p[i & 255] ?? 0;
      this.perm[i] = v;
      this.permMod12[i] = v % 12;
    }
  }

  /** おおよそ -1〜1 の値 */
  noise(x: number, y: number): number {
    const perm = this.perm;
    const pm = this.permMod12;
    // 斜交座標で単体（三角形）を求める
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pm[ii + (perm[jj] ?? 0)] ?? 0;
      t0 *= t0;
      n += t0 * t0 * ((GRAD_X[g] ?? 0) * x0 + (GRAD_Y[g] ?? 0) * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = pm[ii + i1 + (perm[jj + j1] ?? 0)] ?? 0;
      t1 *= t1;
      n += t1 * t1 * ((GRAD_X[g] ?? 0) * x1 + (GRAD_Y[g] ?? 0) * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pm[ii + 1 + (perm[jj + 1] ?? 0)] ?? 0;
      t2 *= t2;
      n += t2 * t2 * ((GRAD_X[g] ?? 0) * x2 + (GRAD_Y[g] ?? 0) * y2);
    }
    // 出力をおおよそ -1〜1 に拡大する係数
    return 70 * n;
  }

  /**
   * fBm（周波数を 2 倍・振幅を半分にして octaves 回重ねる）。おおよそ -1〜1 に正規化した値
   */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /** リッジノイズ（尾根が鋭くなる fBm）。0〜1 */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const r = 1 - Math.abs(this.noise(x * freq, y * freq));
      sum += r * r * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }
}

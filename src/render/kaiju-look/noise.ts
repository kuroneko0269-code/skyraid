// 10-7b: 怪獣の絵を起動時（チャンクを読んだとき）にコードで作る道具（10-7a のネフィルガの textures.ts から共通にした）:
// 決まった種の乱数・繰り返すノイズ・線を描く・ぎざぎざの線・Three.js の絵にする。画像ファイルは使わない
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
} from 'three';

/** 決まった種の乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(i: number, j: number, s: number): number {
  let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 繰り返す値のノイズ（period 格子で折り返す） */
export function noise(x: number, y: number, period: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const w = (i: number, j: number) =>
    hash2(((i % period) + period) % period, ((j % period) + period) % period, s);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = w(xi, yi) + (w(xi + 1, yi) - w(xi, yi)) * ux;
  const b = w(xi, yi + 1) + (w(xi + 1, yi + 1) - w(xi, yi + 1)) * ux;
  return a + (b - a) * uy;
}

export function fbm(u: number, v: number, base: number, s: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = base;
  for (let o = 0; o < 4; o++) {
    sum += amp * noise(u * f, v * f, f, s + o);
    amp *= 0.5;
    f *= 2;
  }
  return sum / 0.9375;
}

/** 線を描く（円を並べて押す。wrap で端を折り返す）。強さは中心 1 → 縁 0 の最大 */
export function stroke(
  buf: Float32Array,
  size: number,
  pts: readonly (readonly [number, number])[],
  width: number,
  strength: number,
  wrap: boolean,
): void {
  const r = Math.max(1, width * size);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * size;
    const n = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.5)));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const cx = (a[0] + (b[0] - a[0]) * t) * size;
      const cy = (a[1] + (b[1] - a[1]) * t) * size;
      const rr = Math.ceil(r);
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          const d = Math.hypot(dx, dy) / r;
          if (d >= 1) continue;
          let x = Math.round(cx + dx);
          let y = Math.round(cy + dy);
          if (wrap) {
            x = ((x % size) + size) % size;
            y = ((y % size) + size) % size;
          } else if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const o = y * size + x;
          const v = (1 - d * d) * strength;
          if (v > (buf[o] ?? 0)) buf[o] = v;
        }
    }
  }
}

/** ぎざぎざに曲がる線（稲妻・傷）。枝分かれは branch の確率 */
export function walk(
  r: () => number,
  x: number,
  y: number,
  angle: number,
  steps: number,
  step: number,
  jitter: number,
): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  let a = angle;
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * jitter;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

export const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Three.js の絵にする（繰り返すかどうか・縮めた絵を作る） */
export function makeKaijuTexture(pixels: Uint8Array, size: number, repeat: boolean): DataTexture {
  const t = new DataTexture(pixels, size, size, RGBAFormat);
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** 絵の容量（縮めた絵を含む。count 枚。バイト。報告とテスト） */
export function kaijuTextureBytes(size: number, count: number): number {
  return size > 0 ? Math.round(size * size * 4 * count * (4 / 3)) : 0;
}

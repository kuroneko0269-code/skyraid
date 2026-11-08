// 10-7a: ネフィルガの絵を起動時（チャンクを読んだとき）にコードで作る（画像ファイルは使わない）。
// 皮膚（三方向から貼る繰り返しの絵）: R うろこの明るさのむら・G つや（粗さ）のむら・B 凹凸の高さ・A 嵐の力が走る発光の筋。
// 膜（翼の付け根 → 先が横・前縁 → 後縁が縦）: R 指の骨と細い筋・G 薄さ（透け）・B 傷・A 発光の筋。乱数は決まった種から
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
} from 'three';
import { KAIJU2_VISUAL } from '../../data/kaiju2-visual';

const V = KAIJU2_VISUAL;

/** 決まった種の乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(i: number, j: number, s: number): number {
  let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 繰り返す値のノイズ（period 格子で折り返す） */
function noise(x: number, y: number, period: number, s: number): number {
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

function fbm(u: number, v: number, base: number, s: number): number {
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
function stroke(
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
function walk(
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

const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/** 皮膚の絵（繰り返し）。size × size × RGBA */
export function buildKaiju2SkinPixels(size: number, seed = 0x6e70): Uint8Array {
  const S = V.skin;
  const r = rng(seed);
  const n = S.scalesPerTile;
  const scars = new Float32Array(size * size);
  const veins = new Float32Array(size * size);
  for (let i = 0; i < S.scars; i++) {
    const pts = walk(r, r(), r(), r() * Math.PI * 2, 10, 0.03 + r() * 0.02, 0.35);
    stroke(scars, size, pts, 0.006 + r() * 0.006, 1, true);
  }
  for (let i = 0; i < S.veins; i++) {
    const pts = walk(r, r(), r(), r() * Math.PI * 2, 26, 0.022, 1.3);
    stroke(veins, size, pts, 0.0045, 1, true);
    // 枝
    for (let b = 0; b < 3; b++) {
      const at = pts[Math.floor(r() * pts.length)] ?? [0, 0];
      stroke(veins, size, walk(r, at[0], at[1], r() * 6.28, 8, 0.018, 1.5), 0.003, 0.7, true);
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * n;
      const v = (y / size) * n;
      const ci = Math.floor(u);
      const cj = Math.floor(v);
      let f1 = 9;
      let f2 = 9;
      let id = 0;
      let dyc = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const gi = (((ci + di) % n) + n) % n;
          const gj = (((cj + dj) % n) + n) % n;
          const px = ci + di + 0.5 + (hash2(gi, gj, 1) - 0.5) * 0.7;
          const py = cj + dj + 0.5 + (hash2(gi, gj, 2) - 0.5) * 0.7;
          const d = Math.hypot(u - px, (v - py) * 1.25);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = hash2(gi, gj, 3);
            dyc = v - py;
          } else if (d < f2) f2 = d;
        }
      const edge = f2 - f1;
      const bulge = Math.min(1, edge / 0.32) ** 0.7;
      // 重なり: 下の縁ほど高い（屋根瓦のように）
      const shingle = bulge * (0.65 + 0.35 * Math.max(-1, Math.min(1, dyc / 0.5)));
      const o = y * size + x;
      const scar = scars[o] ?? 0;
      const low = fbm(x / size, y / size, 3, 11);
      const albedo = 0.55 + 0.22 * (id - 0.5) + 0.3 * (low - 0.5) - 0.22 * (1 - bulge) + 0.3 * scar;
      const rough =
        0.5 + 0.35 * (1 - bulge) + 0.3 * (fbm(x / size, y / size, 5, 23) - 0.5) + 0.25 * scar;
      const height = shingle * (1 - 0.7 * scar);
      out[o * 4] = byte(albedo);
      out[o * 4 + 1] = byte(rough);
      out[o * 4 + 2] = byte(height);
      out[o * 4 + 3] = byte(veins[o] ?? 0);
    }
  return out;
}

/** 翼の膜の絵（繰り返さない。横 = 付け根 → 先、縦 = 前縁 → 後縁） */
export function buildKaiju2MembranePixels(size: number, seed = 0x6d62): Uint8Array {
  const M = V.membrane;
  const r = rng(seed);
  const ribs = new Float32Array(size * size);
  const veins = new Float32Array(size * size);
  const scars = new Float32Array(size * size);
  // 指の骨の筋: 手首（前縁の 0.62）から後縁の先（えぐれの間 1/3・2/3 と先の近く）へ。少し曲げる
  const ends = [0.08, 1 / 3, 2 / 3, 0.93];
  for (let i = 0; i < M.ribs; i++) {
    const e = ends[i] ?? 0.5;
    const s0 = i === 0 ? 0.12 : 0.62;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      pts.push([s0 + (e - s0) * t + Math.sin(t * Math.PI) * 0.03, t]);
    }
    stroke(ribs, size, pts, 0.011, 1, false);
  }
  // 細い筋: 筋と前縁から後縁へ枝分かれ
  for (let i = 0; i < M.veins; i++) {
    const x = r();
    const pts = walk(r, x, r() * 0.6, Math.PI / 2 + (r() - 0.5) * 1.6, 14, 0.025, 0.9);
    stroke(veins, size, pts, 0.0028, 0.55 + r() * 0.45, false);
  }
  for (let i = 0; i < M.scars; i++) {
    const pts = walk(r, r(), 0.3 + r() * 0.7, r() * 6.28, 6, 0.025, 0.6);
    stroke(scars, size, pts, 0.005, 1, false);
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      const rib = ribs[o] ?? 0;
      const vein = veins[o] ?? 0;
      const scar = scars[o] ?? 0;
      const tissue = fbm(x / size, y / size, 6, 31);
      const structure = Math.max(rib, vein * 0.7);
      const thin = 0.85 - 0.75 * rib - 0.35 * vein + 0.25 * (tissue - 0.5) - 0.3 * scar;
      out[o * 4] = byte(structure);
      out[o * 4 + 1] = byte(thin);
      out[o * 4 + 2] = byte(scar);
      out[o * 4 + 3] = byte(Math.max(rib, vein * 0.55));
    }
  return out;
}

/** Three.js の絵にする（繰り返すかどうか・縮めた絵を作る） */
export function makeKaiju2Texture(pixels: Uint8Array, size: number, repeat: boolean): DataTexture {
  const t = new DataTexture(pixels, size, size, RGBAFormat);
  t.wrapS = t.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** 絵の容量（縮めた絵を含む。バイト。報告とテスト） */
export function kaiju2TextureBytes(size: number): number {
  return size > 0 ? Math.round(size * size * 4 * 2 * (4 / 3)) : 0;
}

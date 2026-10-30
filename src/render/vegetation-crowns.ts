// 遠景の木の樹冠のテクスチャ（4-9）。画像アセットを使わず、起動時に手続きで小さなアトラスを作る。
// 列 0〜types-1 が種類ごとの縦の輪郭（行 0: 1 本・行 1: 束 = 3 つの樹冠）、最後の列が上から見た輪郭。
// R = 明るさ ÷ LUMA_SCALE（葉の塊のまだら・上ほど明るい）、A = 覆い（0 / 255。フラグメントで捨てる）。
// 数値は src/data/vegetation.ts の crowns
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat } from 'three';
import { VEGETATION_CONFIG } from '../data/vegetation';

/** R に入れる明るさの倍率（1 を超える明るさを 8bit に入れるため） */
export const CROWN_LUMA_SCALE = 1.5;
/** タイルの縁の余白（px。ミップマップで隣のタイルがにじまないように） */
export const CROWN_MARGIN = 2;

function hash(x: number, y: number, s: number): number {
  const h = Math.imul((x * 73856093) ^ (y * 19349663) ^ (s * 83492791), 1274126177);
  return (((h ^ (h >>> 15)) >>> 0) % 10000) / 10000;
}

/** 2D 値ノイズ（0〜1。葉の塊のまだら） */
function value(x: number, y: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s);
  const b = hash(ix + 1, iy, s);
  const c = hash(ix, iy + 1, s);
  const d = hash(ix + 1, iy + 1, s);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * 樹冠 1 つの半幅（高さに対する割合 t = 0 が樹冠の下端・1 が頂点）。種類ごとに丸みの違う形:
 * 0 = 先の丸い針葉樹、1 = 卵形の広い樹冠、2 = 細く高い丸い樹冠
 */
export function crownHalfWidth(type: number, t: number): number {
  if (t < 0 || t > 1) return 0;
  if (type === 1) {
    const e = (t - 0.42) / 0.58;
    return 0.92 * Math.sqrt(Math.max(0, 1 - e * e));
  }
  if (type === 2) return 0.68 * (1 - t) ** 0.42;
  return (1 - t) ** 0.55;
}

/** 縦の輪郭の 1 画素（u: -1〜1・v: 0〜1）。clump なら 3 つの樹冠。戻り値は 0 = なし・1 = 葉・0.5 = 幹 */
function verticalCoverage(type: number, clump: boolean, u: number, v: number): number {
  const edge = VEGETATION_CONFIG.billboardEdgeNoise;
  const crowns = clump
    ? [
        [-0.52, 0.82, 0.42],
        [0, 1, 0.48],
        [0.5, 0.9, 0.42],
      ]
    : [[0, 1, 1]];
  const base = 0.12;
  for (const [cx = 0, top = 1, width = 1] of crowns) {
    const t = (v - base) / (top - base);
    // 輪郭のでこぼこ（葉の塊）。高さ方向のノイズ
    const lump = 1 + edge * (value(t * 9, cx * 3 + type * 5, 11) - 0.5) * 2;
    if (Math.abs(u - cx) < crownHalfWidth(type, t) * width * lump) return 1;
  }
  // 幹
  return Math.abs(u) < 0.06 && v < 0.2 ? 0.5 : 0;
}

/** 上から見た輪郭（u, v: -1〜1） */
function topCoverage(clump: boolean, u: number, v: number): number {
  const edge = VEGETATION_CONFIG.billboardEdgeNoise;
  let r = Math.hypot(u, v);
  if (clump) {
    r =
      Math.min(
        Math.hypot(u - 0.45, v),
        Math.hypot(u + 0.25, v - 0.4),
        Math.hypot(u + 0.25, v + 0.4),
      ) * 1.45;
  }
  const limit = 0.8 + edge * Math.sin(Math.atan2(v, u) * 7);
  return r < limit ? 1 : 0;
}

/** 樹冠のアトラス（幅 (types + 1) × 高さ 2 タイル）を作る */
export function createCrownTexture(): DataTexture {
  const { types, tileSize } = VEGETATION_CONFIG.crowns;
  const width = (types + 1) * tileSize;
  const height = 2 * tileSize;
  const data = new Uint8Array(width * height * 4);
  // 覆いのない画素にも葉の平均くらいの明るさを入れておく（ミップマップで縁が黒くにじまないように）
  for (let i = 0; i < data.length; i += 4) data[i] = Math.round((0.8 / CROWN_LUMA_SCALE) * 255);
  const inner = tileSize - CROWN_MARGIN * 2;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col <= types; col++) {
      for (let py = 0; py < inner; py++) {
        for (let px = 0; px < inner; px++) {
          const u = ((px + 0.5) / inner) * 2 - 1;
          const v = (py + 0.5) / inner;
          const top = col === types;
          const cover = top
            ? topCoverage(row === 1, u, v * 2 - 1)
            : verticalCoverage(col, row === 1, u, v);
          if (cover === 0) continue;
          // 明るさ: 上ほど明るく（縦。4-8 までの 0.5〜1.1 より下側を明るく）・中心ほど明るく（上から）、葉の塊のまだら
          const blob =
            value(px / 5, py / 5, col * 2 + row) * 0.65 + value(px / 2.2, py / 2.2, 7) * 0.35;
          const shade = top ? 1.15 - 0.4 * Math.hypot(u, v * 2 - 1) : 0.66 + 0.45 * v;
          // 幹は葉の 45% の明るさ
          const luma = shade * (0.85 + 0.3 * blob) * (cover < 1 ? 0.45 : 1);
          const i =
            ((row * tileSize + CROWN_MARGIN + py) * width + col * tileSize + CROWN_MARGIN + px) * 4;
          data[i] = Math.min(255, Math.round((luma / CROWN_LUMA_SCALE) * 255));
          data[i + 3] = 255;
        }
      }
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

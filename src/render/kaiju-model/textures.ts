// 10-7e: ヴォルガスの皮膚の絵（起動時にコードで作る。画像ファイルは使わない。繰り返す 1 枚を三方向から貼る）:
// R 明るさ（鱗の板ごとの色・むら・古傷は明るく）・G 粗さ（板の中ほどはつるり、溝はざらざら）・B 高さ（大きな鱗の板の盛り上がり・
// 間の小さな鱗・しわ・古傷の溝）・A 古傷（白っぽい肉の盛り上がり）
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
import { byte, fbm, hash2, rng, stroke, walk } from '../kaiju-look/noise';

const V = VORGAS_VISUAL.skin;

/** 繰り返すセルノイズ: 最も近い点の距離 F1・2 番目 F2・セルの番号の乱数 */
function cells(u: number, v: number, n: number, s: number, out: Float32Array): void {
  const x = u * n;
  const y = v * n;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = ((cx % n) + n) % n;
      const wy = ((cy % n) + n) % n;
      const px = cx + 0.15 + 0.7 * hash2(wx, wy, s);
      const py = cy + 0.15 + 0.7 * hash2(wx, wy, s + 7);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, s + 13);
      } else if (d < f2) f2 = d;
    }
  out[0] = f1;
  out[1] = f2;
  out[2] = id;
}

/** 皮膚の絵の画素（size × size × RGBA） */
export function buildVorgasSkinPixels(size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const r = rng(7311);
  // 古傷: 3 本ずつ平行に走る爪の跡と、1 本の長い裂け目
  const scar = new Float32Array(size * size);
  for (let i = 0; i < V.scars; i++) {
    const x = r();
    const y = r();
    const a = r() * Math.PI;
    const claws = i % 3 === 2 ? 1 : 3;
    for (let c = 0; c < claws; c++) {
      const ox = x + Math.cos(a + Math.PI / 2) * c * 0.035;
      const oy = y + Math.sin(a + Math.PI / 2) * c * 0.035;
      const len = claws === 1 ? 20 : 9 + Math.floor(r() * 4);
      stroke(scar, size, walk(r, ox, oy, a, len, 0.018, 0.35), 0.006 + r() * 0.004, 1, true);
    }
  }
  const big = new Float32Array(3);
  const small = new Float32Array(3);
  const n = V.platesPerTile;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;
      cells(u, v, n, 11, big);
      cells(u, v, n * 3, 29, small);
      const bf1 = big[0] ?? 0;
      const bf2 = big[1] ?? 0;
      const sf1 = small[0] ?? 0;
      const sf2 = small[1] ?? 0;
      // 大きな鱗の板: 中が盛り上がり、境目の溝で落ちる（板の大きさの 1 割ほどの溝）
      const plateEdge = Math.min(1, (bf2 - bf1) / 0.12);
      const plate = plateEdge * (1 - 0.55 * bf1);
      const smallEdge = Math.min(1, (sf2 - sf1) / 0.18);
      const smallH = smallEdge * (1 - 0.4 * sf1);
      // 大きな板と、その間の小さな鱗（溝のそば）
      const between = 1 - Math.min(1, plateEdge * 1.6);
      const mott = fbm(u, v, 4, 3);
      // しわ（横へ走る細い筋をノイズで曲げる）
      const wr = Math.sin((v * 46 + fbm(u, v, 6, 5) * 5) * Math.PI * 2) * 0.5 + 0.5;
      const wrinkle = wr ** 3 * (0.4 + 0.6 * fbm(u, v, 3, 9));
      const s = scar[py * size + px] ?? 0;
      const height =
        0.62 * plate + 0.28 * smallH * (0.4 + between) + 0.1 * wrinkle - 0.45 * s * (1 - s * 0.6);
      const tone = 0.42 + 0.3 * (big[2] ?? 0) + 0.22 * mott - 0.18 * (1 - plateEdge);
      const o = (py * size + px) * 4;
      out[o] = byte(tone + 0.35 * s);
      out[o + 1] = byte(0.35 + 0.45 * (1 - plateEdge) + 0.2 * mott - 0.25 * s);
      out[o + 2] = byte(Math.max(0, Math.min(1, height)));
      out[o + 3] = byte(s);
    }
  return out;
}

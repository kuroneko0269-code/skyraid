// デカール・機体番号の合成（7-3。Three.js・DOM 非依存）: マスク（decal-raster.ts）を塗装テクスチャの主翼の上面（左右）・
// 垂直尾翼（両面）へマーキング色で重ねる。面の画素の m 単位の位置から図形の座標へ戻すので、翼のテーパー・後退角で歪まない
import type { AircraftShape } from '../../data/aircraft-shapes';
import { SKIN_TEXTURE } from '../../data/skin-texture';
import { SKIN_CONFIG, type DecalSlot } from '../../data/skins';
import type { DecalPlacement } from '../../progression/paint';
import { finSection, wingSection, type WingSection } from '../aircraft-model/planform';
import type { DecalMask } from './decal-raster';

const W = SKIN_TEXTURE.width;
const ROWS = SKIN_TEXTURE.rows;

/** 図形の置き方（見る向きの座標・m）: 中心・大きさ・回転の cos / sin */
export interface Stamp {
  readonly mask: DecalMask;
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
  readonly cos: number;
  readonly sin: number;
}

export function makeStamp(
  mask: DecalMask,
  cx: number,
  cy: number,
  size: number,
  rot: number,
): Stamp {
  return { mask, cx, cy, size, cos: Math.cos(rot), sin: Math.sin(rot) };
}

const lerp = (r: readonly [number, number], v: number): number => r[0] + (r[1] - r[0]) * (v / 255);

/** スライダーの値（0〜255）から置き方を決める */
export function placementStamp(
  shape: Readonly<AircraftShape>,
  slot: DecalSlot,
  p: Readonly<DecalPlacement>,
  mask: DecalMask,
): Stamp {
  const r = SKIN_CONFIG.placement[slot];
  const rot = (p.rotation / 256) * Math.PI * 2 - Math.PI;
  const xf = lerp(r.x, p.x);
  const yf = lerp(r.y, p.y);
  if (slot === 'wing') {
    const w = shape.wing;
    const sec = wingSection(shape, w, xf);
    const mean = (w.rootChord + w.tipChord) / 2;
    return makeStamp(mask, sec.x, -(sec.z + yf * sec.chord), lerp(r.size, p.size) * mean, rot);
  }
  const sec = finSection(shape, yf);
  return makeStamp(
    mask,
    -(sec.z + xf * sec.chord),
    yf * shape.fin.span,
    lerp(r.size, p.size) * shape.fin.span,
    rot,
  );
}

/** マスクの被覆率（双線形。外は 0）。gx・gy は図形の座標（高さ 1、y が上） */
function coverage(m: DecalMask, gx: number, gy: number): number {
  const px = (gx + m.aspect / 2) * m.height - 0.5;
  const py = (0.5 - gy) * m.height - 0.5;
  if (px <= -1 || py <= -1 || px >= m.width || py >= m.height) return 0;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const w = m.width;
  const d = m.data;
  const inX0 = x0 >= 0;
  const inX1 = x0 + 1 < w;
  const inY0 = y0 >= 0;
  const inY1 = y0 + 1 < m.height;
  const a = inX0 && inY0 ? (d[y0 * w + x0] ?? 0) : 0;
  const b = inX1 && inY0 ? (d[y0 * w + x0 + 1] ?? 0) : 0;
  const c = inX0 && inY1 ? (d[(y0 + 1) * w + x0] ?? 0) : 0;
  const e = inX1 && inY1 ? (d[(y0 + 1) * w + x0 + 1] ?? 0) : 0;
  return Math.min(1, (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy);
}

/** 1 画素へ重ねる。gx・gy は見る向きの座標（m。右・上）、mirror は回転を逆にする（左右対称の面の文字） */
function blend(
  out: Uint8Array,
  index: number,
  s: Stamp,
  gx: number,
  gy: number,
  mirror: boolean,
  marking: readonly number[],
): void {
  const sn = mirror ? -s.sin : s.sin;
  const dx = gx - s.cx;
  const dy = gy - s.cy;
  const a =
    coverage(s.mask, (dx * s.cos + dy * sn) / s.size, (-dx * sn + dy * s.cos) / s.size) * 0.97;
  if (a <= 0) return;
  const k = index * 4;
  for (let i = 0; i < 3; i++) {
    const v = out[k + i] ?? 0;
    out[k + i] = Math.round(v + ((marking[i] ?? 0) - v) * a);
  }
}

function reachOf(s: Stamp): number {
  return s.size * Math.max(1, s.mask.aspect) * 0.75;
}

/** 主翼の上面（左右）。左は鏡写し（文字は裏返さず、置き場所と回転だけ対称） */
export function stampWing(
  sections: readonly WingSection[],
  s: Stamp,
  text: boolean,
  marking: readonly number[],
  out: Uint8Array,
): void {
  const reach = reachOf(s);
  for (const side of [1, -1]) {
    const [r0, r1] = side > 0 ? ROWS.wingRightTop : ROWS.wingLeftTop;
    const flip = side < 0 && text;
    for (let col = 0; col < W; col++) {
      const sec = sections[col];
      if (!sec || Math.abs(sec.x - s.cx) > reach) continue;
      // 上から見て右が +X・上が機首（−Z）。左の主翼の文字は x を反転して読める向きに
      const gx = flip ? 2 * s.cx - sec.x : sec.x;
      for (let row = r0; row < r1; row++) {
        const f = (row - r0 + 0.5) / (r1 - r0);
        const z = sec.z + (side > 0 ? 1 - f : f) * sec.chord;
        if (Math.abs(z + s.cy) > reach) continue;
        blend(out, row * W + col, s, gx, -z, flip, marking);
      }
    }
  }
}

/** 垂直尾翼の列の翼弦の割合（列 0〜W/2 が +X 向き・W/2〜W が −X 向き。どちらも中央が前縁） */
export function finChordOf(col: number): number {
  const u = (col + 0.5) / W;
  return Math.min(1, Math.abs(u - 0.5) * 2);
}

/** 高さの割合の断面（rows は高さの行ごとの断面） */
export function finSectionAt(rows: readonly WingSection[], h: number): WingSection {
  const i = Math.min(rows.length - 1, Math.max(0, Math.floor(h * rows.length)));
  const s = rows[i];
  if (!s) throw new Error('Missing vertical tail section');
  return s;
}

/** 垂直尾翼の両面。+X 向きの面は右が機首（−Z）、−X 向きの面は鏡写し（文字は読める向き） */
export function stampFin(
  shape: Readonly<AircraftShape>,
  rows: readonly WingSection[],
  s: Stamp,
  text: boolean,
  marking: readonly number[],
  out: Uint8Array,
): void {
  const reach = reachOf(s);
  const [r0, r1] = ROWS.fin;
  for (let row = r0; row < r1; row++) {
    const h = (row - r0 + 0.5) / (r1 - r0);
    const hm = h * shape.fin.span;
    if (Math.abs(hm - s.cy) > reach) continue;
    const sec = finSectionAt(rows, h);
    for (let col = 0; col < W; col++) {
      const z = sec.z + finChordOf(col) * sec.chord;
      if (Math.abs(z + s.cx) > reach) continue;
      const flip = col >= W / 2 && text;
      blend(out, row * W + col, s, flip ? 2 * s.cx + z : -z, hm, flip, marking);
    }
  }
}

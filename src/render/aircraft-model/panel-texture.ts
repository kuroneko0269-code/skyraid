// パネルラインと汚れの手続きテクスチャ（4-3。画像ファイルは使わない）。1 枚の「濃さ・溝の深さ」から
// 色（機体の色に掛ける灰色）と法線マップを作る。UV のアトラス:
//   v 0〜0.5   胴体（u = 機首からの割合、v × 2 = 周の角度。0 が上）: 枠のライン・点検口・後端の煤・下面の汚れ
//   v 0.5〜0.75 主翼（u = 翼幅、v = 翼弦）: 桁・リブ・操舵面のライン、付け根の汚れ
//   v 0.75〜1  左半分は尾翼（主翼と同じ並び）、右半分は無地（パイロン・ミサイル・キャノピー・ナセル）
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { AIRCRAFT_MODEL_CONFIG } from '../../data/aircraft-model';

export interface PanelTextures {
  readonly map: DataTexture;
  readonly normalMap: DataTexture;
}

/** 濃さ（色に掛ける）と溝の深さ（0 = 平ら、1 = ラインの中心） */
export interface PanelSample {
  shade: number;
  groove: number;
}

const FRAMES = [0.12, 0.2, 0.29, 0.38, 0.47, 0.56, 0.65, 0.74, 0.83, 0.91];
const STRINGERS = [0.08, 0.21, 0.36, 0.5, 0.64, 0.79, 0.92];

function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 値ノイズ（0〜1） */
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 線（位置 at、幅 width の画素）からの近さ 0〜1 */
function line(value: number, at: number, pixels: number, width: number): number {
  return Math.max(0, 1 - (Math.abs(value - at) * pixels) / width);
}

function fuselage(s: number, t: number, size: number, out: PanelSample): void {
  const c = AIRCRAFT_MODEL_CONFIG.texture;
  const wu = c.lineWidth;
  const pu = size;
  const pt = size / 2;
  let g = 0;
  for (const f of FRAMES) g = Math.max(g, line(s, f, pu, wu));
  // 隣の枠の間（ベイ）ごとに縦のラインを少しずらす
  let bay = -1;
  for (let i = 0; i + 1 < FRAMES.length; i++) {
    const a = FRAMES[i] ?? 0;
    const b = FRAMES[i + 1] ?? 1;
    if (s >= a && s < b) bay = i;
  }
  if (bay >= 0) {
    const shift = (bay % 2) * 0.04;
    for (const a of STRINGERS) g = Math.max(g, line(t, a + shift, pt, wu));
    // 点検口: ベイごとに 1 つの小さな四角
    const a0 = FRAMES[bay] ?? 0;
    const a1 = FRAMES[bay + 1] ?? 1;
    const cs = a0 + (a1 - a0) * (0.3 + 0.4 * hash(bay, 7));
    const ct = 0.1 + 0.8 * hash(bay, 11);
    const hs = (a1 - a0) * 0.18;
    const ht = 0.025;
    if (Math.abs(s - cs) <= hs + 2 / pu && Math.abs(t - ct) <= ht + 2 / pt) {
      const edge = Math.max(
        line(Math.abs(s - cs), hs, pu, wu * 0.8),
        line(Math.abs(t - ct), ht, pt, wu * 0.8),
      );
      if (Math.abs(s - cs) <= hs + 1 / pu && Math.abs(t - ct) <= ht + 1 / pt) g = Math.max(g, edge);
    }
  }
  let shade = 1 - (1 - c.lineShade) * g;
  // 排気周りの煤（後端ほど濃い。周の向きに筋）
  const streak = 0.7 + 0.3 * noise(t * 48, s * 3);
  const soot = smooth(c.sootStart, 1, s) ** 1.4 * streak;
  shade *= 1 + (c.sootShade - 1) * soot;
  // 下面の薄い汚れ
  shade *= 1 - 0.07 * smooth(0.3, 0.5, t) * smooth(0.7, 0.5, t) * noise(s * 30, t * 8);
  out.shade = shade;
  out.groove = g;
}

function wing(span: number, chord: number, size: number, root: boolean, out: PanelSample): void {
  const c = AIRCRAFT_MODEL_CONFIG.texture;
  const wu = c.lineWidth;
  const ps = root ? size : size / 2;
  const pc = size / 4;
  let g = Math.max(line(chord, 0.1, pc, wu), line(chord, 0.68, pc, wu), line(chord, 0.75, pc, wu));
  if (chord > 0.1 && chord < 0.68) {
    for (const r of root ? [0.3, 0.45, 0.62, 0.88] : [0.35, 0.7])
      g = Math.max(g, line(span, r, ps, wu));
  }
  let shade = 1 - (1 - c.lineShade) * g;
  if (root) {
    // 付け根の汚れ（整備の手の跡・油）。翼弦方向の筋
    const k = 1 - smooth(0, c.rootGrimeSpan, span);
    const n = 0.6 + 0.4 * noise(span * 40, chord * 6);
    shade *= 1 + (c.rootGrimeShade - 1) * k * n;
    // 後縁から後ろへの薄い流れ跡
    shade *= 1 - 0.05 * smooth(0.6, 1, chord) * noise(span * 90, 1.5);
  }
  out.shade = shade;
  out.groove = g;
}

/** UV（0〜1）の濃さと溝。テクスチャの 1 画素ぶんの線の幅は size で決める */
export function samplePanel(u: number, v: number, size: number, out: PanelSample): PanelSample {
  if (v < 0.5) fuselage(u, v * 2, size, out);
  else if (v < 0.75) wing(u, (v - 0.5) * 4, size, true, out);
  else if (u < 0.5) wing(u * 2, (v - 0.75) * 4, size, false, out);
  else {
    out.shade = 1;
    out.groove = 0;
  }
  // 塗装のむら
  out.shade *= 1 + AIRCRAFT_MODEL_CONFIG.texture.mottle * (noise(u * 26, v * 26) * 2 - 1);
  return out;
}

let cached: PanelTextures | null = null;

/** 色と法線マップ（全機体で共有。初回だけ作る） */
export function panelTextures(): PanelTextures {
  if (cached) return cached;
  const size = AIRCRAFT_MODEL_CONFIG.texture.size;
  const groove = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4);
  const sample: PanelSample = { shade: 1, groove: 0 };
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      samplePanel((i + 0.5) / size, (j + 0.5) / size, size, sample);
      const k = j * size + i;
      groove[k] = sample.groove;
      // sRGB で保存する（読むとリニアの濃さに戻る）
      const g = Math.round(Math.min(1, Math.max(0, sample.shade)) ** (1 / 2.2) * 255);
      color.set([g, g, g, 255], k * 4);
    }
  }
  const normal = new Uint8Array(size * size * 4);
  const depth = 1.4;
  const at = (i: number, j: number): number =>
    groove[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))] ?? 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // 溝は凹み（高さ = −groove）
      const dx = -(at(i + 1, j) - at(i - 1, j)) / 2;
      const dy = -(at(i, j + 1) - at(i, j - 1)) / 2;
      const nx = -dx * depth;
      const ny = -dy * depth;
      const l = Math.hypot(nx, ny, 1);
      const k = (j * size + i) * 4;
      normal[k] = Math.round((nx / l / 2 + 0.5) * 255);
      normal[k + 1] = Math.round((ny / l / 2 + 0.5) * 255);
      normal[k + 2] = Math.round((1 / l / 2 + 0.5) * 255);
      normal[k + 3] = 255;
    }
  }
  const make = (data: Uint8Array): DataTexture => {
    const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const map = make(color);
  map.colorSpace = SRGBColorSpace;
  cached = { map, normalMap: make(normal) };
  return cached;
}

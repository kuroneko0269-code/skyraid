// 塗装パターン 8 種の色（7-3。Three.js・DOM 非依存）: テクスチャの 1 画素の場所（面の種類・面の中の m 単位の座標・上向き度・
// 翼幅と翼弦の割合）から「色の番号」を決め、番号 → RGBA（32 ビット）の表で書く（1 画素ごとに色を計算しないで速くする）。
// 4-3 のパネルライン・汚れはシェーダーで上から掛ける（material.ts）
import { SKIN_CONFIG, type SkinPatternDef } from '../../data/skins';

export const SURFACE = { fuselage: 0, wing: 1, fin: 2, stab: 3 } as const;
export type SurfaceKind = (typeof SURFACE)[keyof typeof SURFACE];

/** 色の番号: 基本・アクセント・マーキング・暗い基本色・迷彩の 3 色・白。金属地は METAL_BASE + 塗り分け × 段数 + 明るさの段 */
export const TONE = {
  base: 0,
  accent: 1,
  marking: 2,
  dark: 3,
  camo0: 4,
  camo1: 5,
  camo2: 6,
  white: 7,
} as const;
const METAL_BASE = 8;
const METAL_LEVELS = 32;
/** 金属地の明るさの範囲（1 ± この値を METAL_LEVELS 段に） */
const METAL_RANGE = 0.15;

export interface PatternContext {
  readonly def: SkinPatternDef;
  /** 色の番号 → RGBA（リトルエンディアンの Uint32: r | g << 8 | b << 16 | a << 24） */
  readonly lut: Uint32Array;
  /** マーキング色（デカールの合成） */
  readonly marking: readonly number[];
  /** スプリッターの直線（cos・sin・距離の並び） */
  readonly lines: Float64Array;
}

export function hexRgb(hex: number): number[] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function pack(c: readonly number[], scale = 1): number {
  const ch = (i: number): number => Math.min(255, Math.max(0, Math.round((c[i] ?? 0) * scale)));
  return (ch(0) | (ch(1) << 8) | (ch(2) << 16) | (255 << 24)) >>> 0;
}

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

export function patternContext(
  def: SkinPatternDef,
  base: number,
  accent: number,
  marking: number,
): PatternContext {
  const b = hexRgb(base);
  const a = hexRgb(accent);
  const m = hexRgb(marking);
  const lut = new Uint32Array(METAL_BASE + 2 * METAL_LEVELS);
  lut[TONE.base] = pack(b);
  lut[TONE.accent] = pack(a);
  lut[TONE.marking] = pack(m);
  lut[TONE.dark] = pack(b, SKIN_CONFIG.splitter.darkShade);
  def.tones.forEach((t, i) => (lut[TONE.camo0 + i] = pack(hexRgb(t))));
  lut[TONE.white] = pack([255, 255, 255]);
  for (let trim = 0; trim < 2; trim++) {
    for (let l = 0; l < METAL_LEVELS; l++) {
      const shade = 1 - METAL_RANGE + (2 * METAL_RANGE * l) / (METAL_LEVELS - 1);
      lut[METAL_BASE + trim * METAL_LEVELS + l] = pack(trim ? a : b, shade);
    }
  }
  const n = SKIN_CONFIG.splitter.lines;
  const lines = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ang = hash(i, 91) * Math.PI;
    lines[i * 3] = Math.cos(ang);
    lines[i * 3 + 1] = Math.sin(ang);
    lines[i * 3 + 2] = (hash(i, 37) * 2 - 1) * 5;
  }
  return { def, lut, marking: m, lines };
}

const C = SKIN_CONFIG;

/** 単色・金属地の塗り分け（翼端・垂直尾翼の上端・ラダー）か */
function isTrim(kind: SurfaceKind, span: number, chord: number): boolean {
  const t = C.trim;
  if (kind === SURFACE.wing) return span >= t.wingTip;
  if (kind === SURFACE.fin)
    return (
      span >= t.finTop ||
      (chord >= t.rudderChord && span >= t.rudderSpan[0] && span <= t.rudderSpan[1])
    );
  return false;
}

/** ストライプの帯の色。a は帯の中心からの距離、half は帯の半分の幅、pin は縁取りの幅（m） */
function band(a: number, half: number, pin: number): number {
  const d = Math.abs(a);
  return d <= half ? TONE.accent : d <= half + pin ? TONE.marking : TONE.base;
}

function stripe(kind: SurfaceKind, p: number, up: number, span: number): number {
  const s = C.stripe;
  if (kind === SURFACE.fuselage)
    return up > 0 ? band(p - s.gap / 2 - s.width / 2, s.width / 2, s.pin) : TONE.base;
  if (kind === SURFACE.stab) return TONE.base;
  const [lo, hi] = kind === SURFACE.wing ? s.wing : s.fin;
  // 割合の帯を m に直す（p は横の距離・高さで、span の割合に比例）
  const scale = span > 0 ? p / span : 1;
  return band((span - (lo + hi) / 2) * scale, ((hi - lo) / 2) * scale, s.pin);
}

function camo(kind: SurfaceKind, up: number, span: number, n: number): number {
  if (kind === SURFACE.fin && span >= C.trim.finTop) return TONE.accent;
  if (up < C.camoUnderside) return TONE.base;
  return n < 0.44 ? TONE.camo0 : n < 0.6 ? TONE.camo1 : TONE.camo2;
}

function splitter(lines: Float64Array, p: number, q: number): number {
  let sum = 0;
  const x = p - 2;
  for (let i = 0; i < lines.length; i += 3)
    if (x * (lines[i] ?? 0) + q * (lines[i + 1] ?? 0) > (lines[i + 2] ?? 0)) sum++;
  const i = sum % 3;
  return i === 0 ? TONE.base : i === 1 ? TONE.accent : TONE.dark;
}

function metal(
  kind: SurfaceKind,
  p: number,
  q: number,
  span: number,
  chord: number,
  brush: number,
): number {
  const m = C.metal;
  const panel = hash(Math.floor(q / m.panel[0]), Math.floor(p / m.panel[1]) + 7) * 2 - 1;
  const shade = m.panelTint * panel + m.brush * brush;
  const level = Math.round(((shade + METAL_RANGE) / (2 * METAL_RANGE)) * (METAL_LEVELS - 1));
  const l = Math.min(METAL_LEVELS - 1, Math.max(0, level));
  return METAL_BASE + (isTrim(kind, span, chord) ? METAL_LEVELS : 0) + l;
}

/** なめらかな場（ノイズ）を使うパターンか。使うなら場を粗い格子で計算して補間する（skin-texture.ts） */
export function usesField(c: PatternContext): boolean {
  const id = c.def.id;
  return id === 'camoForest' || id === 'camoDesert' || id === 'camoOcean' || id === 'metal';
}

/** なめらかな場: 迷彩はノイズ 2 段（0〜1）、金属地は前後方向のヘアライン（−1〜1） */
export function fieldAt(c: PatternContext, p: number, q: number): number {
  if (c.def.id === 'metal') return noise(q * 0.7, p * C.metal.brushFrequency) * 2 - 1;
  const k = 1 / C.camoScale;
  const x = p * k + 17.3;
  const y = q * k + 5.1;
  return noise(x, y) * 0.65 + noise(x * 2.3 + 3.7, y * 2.3 + 1.9) * 0.35;
}

/**
 * 1 画素の色の番号。p・q は面の中の座標（m。胴体 = 上の中心線からの周の長さ・前後、翼 = 中心線からの横の距離・前後、
 * 垂直尾翼 = 高さ・前後）、up は上向きの度合い（1 = 上面・−1 = 下面）、span・chord は翼幅（高さ）・翼弦の割合、
 * field は fieldAt の値（使わないパターンは 0）
 */
export function toneAt(
  c: PatternContext,
  kind: SurfaceKind,
  p: number,
  q: number,
  up: number,
  span: number,
  chord: number,
  field: number,
): number {
  switch (c.def.id) {
    case 'solid':
      return isTrim(kind, span, chord) ? TONE.accent : TONE.base;
    case 'camoForest':
    case 'camoDesert':
    case 'camoOcean':
      return camo(kind, up, span, field);
    case 'twoTone':
      if (kind === SURFACE.fuselage)
        return up > -0.12 + 0.07 * Math.sin(q * 0.8) ? TONE.base : TONE.accent;
      return up >= 0 ? TONE.base : TONE.accent;
    case 'splitter':
      return splitter(c.lines, p, q);
    case 'stripe':
      return stripe(kind, p, up, span);
    case 'metal':
      return metal(kind, p, q, span, chord, field);
  }
}

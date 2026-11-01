// 塗装テクスチャの生成（7-3。Three.js・DOM 非依存）: 機体の形と塗装からアトラス（skin-atlas.ts）の画素（sRGB の RGBA）を作る。
// 1. パターンの「色の番号」の地図（形 × パターンごとにキャッシュ。色・デカール・番号を変えるだけなら作り直さない）
// 2. 番号 → 色の表で塗る 3. デカール（主翼の上面の左右・垂直尾翼の両面）4. 機体番号（垂直尾翼の両面）。
// 変更のたびに作り直す（1 回 50ms 以内。tests/skins.test.ts）。GPU に送るのは skin-material.ts
import type { AircraftShape } from '../../data/aircraft-shapes';
import { SKIN_TEXTURE } from '../../data/skin-texture';
import { SKIN_CONFIG, SKIN_PALETTE, findSkinPattern, type SkinPatternId } from '../../data/skins';
import type { DecalPlacement, Paint } from '../../progression/paint';
import { finSection, wingSection, type WingSection } from '../aircraft-model/planform';
import { decalShape, numberShape } from './decal-shapes';
import { maskFor, type DecalMask } from './decal-raster';
import {
  SURFACE,
  TONE,
  fieldAt,
  patternContext,
  toneAt,
  usesField,
  type PatternContext,
  type SurfaceKind,
} from './skin-patterns';
import {
  finChordOf,
  finSectionAt,
  makeStamp,
  placementStamp,
  stampFin,
  stampWing,
} from './skin-stamps';

const W = SKIN_TEXTURE.width;
const H = SKIN_TEXTURE.height;
const ROWS = SKIN_TEXTURE.rows;

export function skinPixelCount(): number {
  return W * H * 4;
}

/** 列・行ごとの断面（翼幅・高さの割合 → 断面）。機体の形ごとに持つ */
interface Sections {
  readonly wing: WingSection[];
  readonly stab: WingSection[];
  readonly fin: WingSection[];
}

const sectionCache = new WeakMap<object, Sections>();

function sectionsOf(shape: Readonly<AircraftShape>): Sections {
  let s = sectionCache.get(shape);
  if (!s) {
    const list = (count: number, f: (u: number) => WingSection): WingSection[] =>
      Array.from({ length: count }, (_, i) => f((i + 0.5) / count));
    s = {
      wing: list(W, (u) => wingSection(shape, shape.wing, u)),
      stab: list(W, (u) => wingSection(shape, shape.stabilizer, u)),
      fin: list(ROWS.fin[1] - ROWS.fin[0], (u) => finSection(shape, u)),
    };
    sectionCache.set(shape, s);
  }
  return s;
}

// ---------------------------------------------------------------- 色の番号の地図

/** 1 画素の場所（locate が書く入れ物）。p・q・up・span・chord は toneAt の引数 */
const at = { p: 0, q: 0, up: 0, span: 0, chord: 0 };

interface Region {
  readonly rows: readonly [number, number];
  readonly kind: SurfaceKind;
  /** 行・列 → at */
  readonly locate: (row: number, col: number) => void;
}

function regions(shape: Readonly<AircraftShape>, sec: Sections): Region[] {
  const perimeter = (Math.PI * (shape.fuselageWidth + shape.fuselageHeight)) / 2;
  const [f0, f1] = ROWS.fuselage;
  const fuselage: Region = {
    rows: ROWS.fuselage,
    kind: SURFACE.fuselage,
    locate: (row, col) => {
      const t = (row - f0 + 0.5) / (f1 - f0);
      const s = (col + 0.5) / W;
      at.up = Math.cos(t * Math.PI * 2);
      at.p = Math.min(t, 1 - t) * perimeter;
      at.q = s * shape.length;
      at.span = s;
      at.chord = 0;
    },
  };
  // 主翼・水平尾翼の 1 つの面。leadingAtEnd は前縁（翼弦 0）が行の終わりの側
  const wing = (
    rows: readonly [number, number],
    kind: SurfaceKind,
    list: readonly WingSection[],
    top: boolean,
    leadingAtEnd: boolean,
  ): Region => ({
    rows,
    kind,
    locate: (row, col) => {
      const f = (row - rows[0] + 0.5) / (rows[1] - rows[0]);
      const x = leadingAtEnd ? 1 - f : f;
      const s = list[col];
      at.up = top ? 1 : -1;
      at.p = s?.x ?? 0;
      at.q = (s?.z ?? 0) + x * (s?.chord ?? 0);
      at.span = (col + 0.5) / W;
      at.chord = x;
    },
  });
  const [n0, n1] = ROWS.fin;
  const fin: Region = {
    rows: ROWS.fin,
    kind: SURFACE.fin,
    locate: (row, col) => {
      const h = (row - n0 + 0.5) / (n1 - n0);
      const s = finSectionAt(sec.fin, h);
      const x = finChordOf(col);
      at.up = 0;
      at.p = h * shape.fin.span;
      at.q = s.z + x * s.chord;
      at.span = h;
      at.chord = x;
    },
  };
  return [
    fuselage,
    wing(ROWS.wingRightTop, SURFACE.wing, sec.wing, true, true),
    wing(ROWS.wingRightBottom, SURFACE.wing, sec.wing, false, false),
    wing(ROWS.wingLeftBottom, SURFACE.wing, sec.wing, false, true),
    wing(ROWS.wingLeftTop, SURFACE.wing, sec.wing, true, false),
    wing(ROWS.stabTop, SURFACE.stab, sec.stab, true, true),
    wing(ROWS.stabBottom, SURFACE.stab, sec.stab, false, false),
    fin,
  ];
}

const CW = W / 2 + 1;

/** 格子の場の双線形補間（j0 は格子の行、tj は行の間の割合） */
function fieldBetween(field: Float32Array, j0: number, tj: number, col: number): number {
  const fi = col / 2;
  const i0 = Math.floor(fi);
  const ti = fi - i0;
  const k = j0 * CW + i0;
  const k0 = field[k] ?? 0;
  const k1 = field[k + CW] ?? 0;
  const a = k0 + ((field[k + 1] ?? 0) - k0) * ti;
  const b = k1 + ((field[k + CW + 1] ?? 0) - k1) * ti;
  return a + (b - a) * tj;
}

/**
 * 1 つの面の色の番号: まず 2 画素おきの格子（と、なめらかな場）を計算し、2 × 2 の区画の 4 隅が同じ番号なら区画を
 * その番号で埋める。違う区画（模様の境目）だけ 1 画素ずつ計算する（場は格子から双線形補間）。金属地は明るさの段が
 * 1 段違うだけなら同じとみなす（境目以外の計算を省く）
 */
function toneRegion(c: PatternContext, r: Region, tones: Uint8Array): void {
  const [r0, r1] = r.rows;
  const rowsN = r1 - r0;
  const ch = Math.ceil(rowsN / 2) + 1;
  const smooth = usesField(c);
  const field = smooth ? new Float32Array(CW * ch) : null;
  const grid = new Uint8Array(CW * ch);
  for (let j = 0; j < ch; j++) {
    const row = Math.min(r1 - 1, r0 + j * 2);
    for (let i = 0; i < CW; i++) {
      r.locate(row, Math.min(W - 1, i * 2));
      const f = field ? fieldAt(c, at.p, at.q) : 0;
      if (field) field[j * CW + i] = f;
      grid[j * CW + i] = toneAt(c, r.kind, at.p, at.q, at.up, at.span, at.chord, f);
    }
  }
  const metal = c.def.id === 'metal';
  const same = (a: number, b: number): boolean => a === b || (metal && Math.abs(a - b) <= 1);
  for (let j = 0; j * 2 < rowsN; j++) {
    for (let i = 0; i < CW - 1; i++) {
      const k = j * CW + i;
      const t = grid[k] ?? 0;
      const uniform =
        same(t, grid[k + 1] ?? 0) && same(t, grid[k + CW] ?? 0) && same(t, grid[k + CW + 1] ?? 0);
      for (let dy = 0; dy < 2; dy++) {
        const row = r0 + j * 2 + dy;
        if (row >= r1) break;
        for (let dx = 0; dx < 2; dx++) {
          const col = i * 2 + dx;
          let tone = t;
          if (!uniform && (dx > 0 || dy > 0)) {
            r.locate(row, col);
            const f = field ? fieldBetween(field, j, dy / 2, col) : 0;
            tone = toneAt(c, r.kind, at.p, at.q, at.up, at.span, at.chord, f);
          }
          tones[row * W + col] = tone;
        }
      }
    }
  }
}

/** 形 × パターンの色の番号の地図（最近の数枚だけ持つ） */
const toneCache: { shape: object; pattern: SkinPatternId; tones: Uint8Array }[] = [];
const TONE_CACHE_SIZE = 4;

/** 色の番号の地図のキャッシュを捨てる（テストで毎回作り直しの時間を測る） */
export function clearSkinCache(): void {
  toneCache.length = 0;
}

function toneMap(shape: Readonly<AircraftShape>, c: PatternContext): Uint8Array {
  const id = c.def.id;
  const hit = toneCache.findIndex((e) => e.shape === shape && e.pattern === id);
  const cached = hit >= 0 ? toneCache.splice(hit, 1)[0] : undefined;
  if (cached) {
    toneCache.unshift(cached);
    return cached.tones;
  }
  const tones = new Uint8Array(W * H);
  for (const r of regions(shape, sectionsOf(shape))) toneRegion(c, r, tones);
  const [c0, c1] = ROWS.clean;
  for (let row = c0; row < c1; row++)
    for (let col = 0; col < W; col++) tones[row * W + col] = col < W / 2 ? TONE.base : TONE.white;
  toneCache.unshift({ shape, pattern: id, tones });
  toneCache.length = Math.min(toneCache.length, TONE_CACHE_SIZE);
  return tones;
}

// ---------------------------------------------------------------- 塗る

function maskOf(p: Readonly<DecalPlacement>, number: number): DecalMask | null {
  const id = p.decal;
  if (id === null) return null;
  return maskFor(id === 'number' ? `n${number}` : id, () => decalShape(id, number));
}

/** 塗装テクスチャの画素（RGBA、sRGB）を out（なければ新しく）に書く */
export function paintSkinPixels(
  shape: Readonly<AircraftShape>,
  paint: Readonly<Paint>,
  out: Uint8Array = new Uint8Array(skinPixelCount()),
): Uint8Array {
  const def = findSkinPattern(paint.pattern) ?? findSkinPattern('solid');
  if (!def) throw new Error('塗装パターンの定義がありません');
  const hex = (i: number): number => SKIN_PALETTE[i]?.hex ?? 0x808080;
  const c = patternContext(def, hex(paint.base), hex(paint.accent), hex(paint.marking));
  const tones = toneMap(shape, c);
  // 1 画素 = 1 つの Uint32（リトルエンディアンの RGBA）
  const px = new Uint32Array(out.buffer, out.byteOffset, out.length / 4);
  const lut = c.lut;
  for (let i = 0; i < px.length; i++) px[i] = lut[tones[i] ?? 0] ?? 0;

  const sec = sectionsOf(shape);
  const wingMask = maskOf(paint.wing, paint.number);
  if (wingMask) {
    const s = placementStamp(shape, 'wing', paint.wing, wingMask);
    stampWing(sec.wing, s, paint.wing.decal === 'number', c.marking, out);
  }
  const finMask = maskOf(paint.fin, paint.number);
  if (finMask) {
    const s = placementStamp(shape, 'fin', paint.fin, finMask);
    stampFin(shape, sec.fin, s, paint.fin.decal === 'number', c.marking, out);
  }
  // 機体番号（垂直尾翼の両面。いつも読める向き）
  const n = SKIN_CONFIG.number;
  const num = finSection(shape, n.height);
  const mask = maskFor(`n${paint.number}`, () => numberShape(paint.number));
  const stamp = makeStamp(
    mask,
    -(num.z + n.chord * num.chord),
    n.height * shape.fin.span,
    n.size * shape.fin.span,
    0,
  );
  stampFin(shape, sec.fin, stamp, true, c.marking, out);
  return out;
}

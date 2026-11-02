// 機体の塗装（7-3、Three.js・DOM 非依存）: 型・初期値・読み込んだ値の確認・14 バイトの直列化（P2P の名簿・リプレイのヘッダ）。
// 見た目だけ。loadout（性能）には一切入らない
import type { AircraftShape } from '../data/aircraft-shapes';
import {
  DECAL_IDS,
  SKIN_CONFIG,
  SKIN_PALETTE,
  SKIN_PATTERN_IDS,
  type DecalId,
  type DecalSlot,
  type SkinPatternId,
} from '../data/skins';

/** デカール 1 枚の置き方。x・y・size・rotation は 0〜255 の整数（範囲は SKIN_CONFIG.placement） */
export interface DecalPlacement {
  decal: DecalId | null;
  x: number;
  y: number;
  size: number;
  rotation: number;
}

export interface Paint {
  pattern: SkinPatternId;
  /** パレット（SKIN_PALETTE）の番号: 基本色・アクセント色・マーキング色（デカールと機体番号） */
  base: number;
  accent: number;
  marking: number;
  /** 垂直尾翼の機体番号（0〜99） */
  number: number;
  wing: DecalPlacement;
  fin: DecalPlacement;
}

/** 直列化したバイト数（1 人 16 バイト以内） */
export const PAINT_BYTES = 14;

export function defaultPlacement(slot: DecalSlot): DecalPlacement {
  return { decal: null, ...SKIN_CONFIG.defaultPlacement[slot] };
}

/** パレットの番号（元の色と同じ色。なければ 0） */
function paletteIndexOf(hex: number): number {
  return Math.max(
    0,
    SKIN_PALETTE.findIndex((c) => c.hex === hex),
  );
}

/** sRGB の明るさ（0〜1） */
function luminance(hex: number): number {
  return (
    (0.2126 * ((hex >> 16) & 0xff) + 0.7152 * ((hex >> 8) & 0xff) + 0.0722 * (hex & 0xff)) / 255
  );
}

const BLACK = SKIN_PALETTE.findIndex((c) => c.id === 'black');
const WHITE = SKIN_PALETTE.findIndex((c) => c.id === 'white');

/**
 * 機体の初期の塗装: 単色で 4-3 の機体の色・アクセント色、マーキングは基本色が明るければ黒・暗ければ白。
 * number が null なら rng で 00〜99 を決める
 */
export function defaultPaint(
  shape: Readonly<AircraftShape>,
  number: number | null = null,
  rng: () => number = Math.random,
): Paint {
  const base = paletteIndexOf(shape.bodyColor);
  return {
    pattern: 'solid',
    base,
    accent: paletteIndexOf(shape.accentColor),
    marking: luminance(shape.bodyColor) > 0.45 ? BLACK : WHITE,
    number: number ?? Math.min(SKIN_CONFIG.numberMax, Math.floor(rng() * 100)),
    wing: defaultPlacement('wing'),
    fin: defaultPlacement('fin'),
  };
}

export function clonePaint(p: Readonly<Paint>): Paint {
  return { ...p, wing: { ...p.wing }, fin: { ...p.fin } };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function intIn(v: unknown, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback;
}

function normalizePlacement(v: unknown, slot: DecalSlot): DecalPlacement {
  const d = defaultPlacement(slot);
  if (!isObj(v)) return d;
  return {
    decal: (DECAL_IDS as readonly unknown[]).includes(v.decal) ? (v.decal as DecalId) : null,
    x: intIn(v.x, 255, d.x),
    y: intIn(v.y, 255, d.y),
    size: intIn(v.size, 255, d.size),
    rotation: intIn(v.rotation, 255, d.rotation),
  };
}

/** 読み込んだ値（セーブの JSON）を確かめる。項目ごとに不正なら fallback の値 */
export function normalizePaint(v: unknown, fallback: Readonly<Paint>): Paint {
  const out = clonePaint(fallback);
  if (!isObj(v)) return out;
  const colors = SKIN_PALETTE.length - 1;
  if ((SKIN_PATTERN_IDS as readonly unknown[]).includes(v.pattern))
    out.pattern = v.pattern as SkinPatternId;
  out.base = intIn(v.base, colors, out.base);
  out.accent = intIn(v.accent, colors, out.accent);
  out.marking = intIn(v.marking, colors, out.marking);
  out.number = intIn(v.number, SKIN_CONFIG.numberMax, out.number);
  out.wing = normalizePlacement(v.wing, 'wing');
  out.fin = normalizePlacement(v.fin, 'fin');
  return out;
}

// ---------------------------------------------------------------- 直列化（14 バイト）
// 0: パターン / 1: 基本色 << 4 | アクセント色 / 2: マーキング色 / 3: 機体番号 /
// 4〜8: 主翼のデカール（番号 + 1。0 はなし）・x・y・size・rotation / 9〜13: 垂直尾翼のデカール

function writePlacement(out: Uint8Array, at: number, p: Readonly<DecalPlacement>): void {
  out[at] = p.decal === null ? 0 : DECAL_IDS.indexOf(p.decal) + 1;
  out[at + 1] = p.x;
  out[at + 2] = p.y;
  out[at + 3] = p.size;
  out[at + 4] = p.rotation;
}

function readPlacement(b: Uint8Array, at: number): DecalPlacement {
  const id = b[at] ?? 0;
  return {
    decal: id === 0 ? null : (DECAL_IDS[id - 1] ?? null),
    x: b[at + 1] ?? 0,
    y: b[at + 2] ?? 0,
    size: b[at + 3] ?? 0,
    rotation: b[at + 4] ?? 0,
  };
}

export function encodePaint(p: Readonly<Paint>): Uint8Array {
  const out = new Uint8Array(PAINT_BYTES);
  out[0] = Math.max(0, SKIN_PATTERN_IDS.indexOf(p.pattern));
  out[1] = ((p.base & 0x0f) << 4) | (p.accent & 0x0f);
  out[2] = p.marking & 0x0f;
  out[3] = p.number;
  writePlacement(out, 4, p.wing);
  writePlacement(out, 9, p.fin);
  return out;
}

/** バイト列から読む。長さ・値が不正なら null（範囲外の色・番号・パターンも不正） */
export function decodePaint(b: Uint8Array): Paint | null {
  if (b.length !== PAINT_BYTES) return null;
  const pattern = SKIN_PATTERN_IDS[b[0] ?? 255];
  const colors = SKIN_PALETTE.length;
  const base = (b[1] ?? 0) >> 4;
  const accent = (b[1] ?? 0) & 0x0f;
  const marking = b[2] ?? 255;
  const number = b[3] ?? 255;
  const decalOk = (i: number): boolean => (b[i] ?? 0) <= DECAL_IDS.length;
  if (
    !pattern ||
    base >= colors ||
    accent >= colors ||
    marking >= colors ||
    number > SKIN_CONFIG.numberMax ||
    !decalOk(4) ||
    !decalOk(9)
  )
    return null;
  return {
    pattern,
    base,
    accent,
    marking,
    number,
    wing: readPlacement(b, 4),
    fin: readPlacement(b, 9),
  };
}

/** 16 進の文字列（リプレイのヘッダの JSON に入れる） */
export function paintToHex(p: Readonly<Paint>): string {
  return Array.from(encodePaint(p), (v) => v.toString(16).padStart(2, '0')).join('');
}

export function paintFromHex(text: unknown): Paint | null {
  if (typeof text !== 'string' || !/^[0-9a-f]+$/.test(text) || text.length !== PAINT_BYTES * 2)
    return null;
  const b = new Uint8Array(PAINT_BYTES);
  for (let i = 0; i < PAINT_BYTES; i++) b[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return decodePaint(b);
}

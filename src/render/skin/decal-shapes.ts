// デカールの図形（7-3。Three.js・DOM 非依存）: 10 種の図柄と機体番号の数字を多角形（輪の並び。偶奇の塗り）で作る。
// 同じ多角形から、ハンガーのサムネイル用の SVG のパスと、塗装テクスチャへ合成するマスク（decal-raster.ts）を作る。
// 座標は高さ 1（y −0.5〜0.5、上が +y）・幅 aspect の箱の中。実在の軍のマーク・国旗・ブランドは入れない
import type { DecalId } from '../../data/skins';

/** 輪（x0, y0, x1, y1, ... の並び。閉じる点は繰り返さない） */
export type Ring = readonly number[];

export interface DecalShape {
  readonly rings: readonly Ring[];
  /** 幅 ÷ 高さ */
  readonly aspect: number;
  /** 文字（機体番号）: 鏡に映すと読めないので、左右対称の面でも裏返さない */
  readonly text: boolean;
}

function regular(n: number, r: number, cx = 0, cy = 0, phase = Math.PI / 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/** 星形（外の半径と内の半径を交互に） */
function starRing(points: number, outer: number, inner: number, cy = 0, inner2 = inner): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : i % 4 === 1 ? inner : inner2;
    out.push(Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

function shift(ring: Ring, dx: number, dy: number): number[] {
  return ring.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
}

/** 右半分（上から下へ）を左右に鏡写しにして 1 つの輪にする */
function mirrored(right: Ring): number[] {
  const out = [...right];
  for (let i = right.length - 2; i >= 0; i -= 2) {
    const x = right[i] ?? 0;
    if (Math.abs(x) > 1e-9) out.push(-x, right[i + 1] ?? 0);
  }
  return out;
}

/** 爪痕の 1 本（少し曲がった細い三日月） */
function slash(x0: number): number[] {
  const steps = 10;
  const left: number[] = [];
  const right: number[] = [];
  const nx = 0.92 / 0.968;
  const ny = -0.3 / 0.968;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const cx = x0 + 0.15 - 0.3 * t + 0.05 * Math.sin(Math.PI * t);
    const cy = 0.47 - 0.94 * t;
    const w = 0.065 * Math.sin(Math.PI * t) + 0.004;
    right.push(cx + nx * w, cy + ny * w);
    left.unshift(cx - nx * w, cy - ny * w);
  }
  // left は (x, y) の組ごとに前へ足したので、下 → 上の順に並んでいる
  return [...right, ...left];
}

function decalRings(id: Exclude<DecalId, 'number'>): Ring[] {
  switch (id) {
    case 'chevron': {
      const v = [-0.48, 0, 0, 0.42, 0.48, 0, 0.48, -0.18, 0, 0.24, -0.48, -0.18];
      return [shift(v, 0, 0.06), shift(v, 0, -0.3)];
    }
    case 'hexring':
      return [regular(6, 0.49), regular(6, 0.33), regular(6, 0.14)];
    case 'diamonds': {
      const d = (cx: number, cy: number): number[] => [
        cx,
        cy + 0.2,
        cx + 0.2,
        cy,
        cx,
        cy - 0.2,
        cx - 0.2,
        cy,
      ];
      return [d(0, 0.25), d(-0.25, -0.17), d(0.25, -0.17)];
    }
    case 'star':
      return [starRing(5, 0.52, 0.21, -0.04)];
    case 'bolt':
      return [[0.05, 0.5, -0.25, -0.02, 0, -0.02, -0.12, -0.5, 0.28, 0.08, 0.04, 0.08, 0.3, 0.5]];
    case 'bird':
      return [
        mirrored([
          0, 0.4, 0.06, 0.31, 0.11, 0.18, 0.5, 0.05, 0.13, 0.02, 0.09, -0.13, 0.23, -0.49, 0.02,
          -0.2, 0, -0.2,
        ]),
      ];
    case 'checker': {
      const out: Ring[] = [];
      const n = 4;
      const s = 0.9 / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if ((i + j) % 2 !== 0) continue;
          const x = -0.45 + i * s;
          const y = -0.45 + j * s;
          out.push([x, y, x + s, y, x + s, y + s, x, y + s]);
        }
      }
      return out;
    }
    case 'claws':
      return [slash(-0.29), slash(0), slash(0.29)];
    case 'compass':
      return [starRing(8, 0.5, 0.11, 0, 0.11).map((v, i) => v * scaleCompass(i))];
  }
}

/** 方位星: 斜めの 4 本の先（輪の 4 番目ごとの点の外側）を短くする */
function scaleCompass(i: number): number {
  const point = Math.floor(i / 2);
  return point % 4 === 2 ? 0.6 : 1;
}

// ---------------------------------------------------------------- 数字（7 セグメント。先のとがった六角形を斜めで突き合わせる）

const DIGIT_W = 0.6;
const DIGIT_GAP = 0.16;
const SEG_H = 0.09;
const SEG_GAP = 0.008;
/** 0〜9 の点くセグメント（a 上・b 右上・c 右下・d 下・e 左下・f 左上・g 中） */
const DIGIT_SEGMENTS = [
  'abcdef',
  'bc',
  'abged',
  'abgcd',
  'fgbc',
  'afgcd',
  'afgedc',
  'abc',
  'abcdefg',
  'abcdfg',
] as const;

function horizontal(x0: number, x1: number, y: number): number[] {
  const h = SEG_H;
  const g = SEG_GAP;
  return [
    x0 + g,
    y,
    x0 + g + h,
    y + h,
    x1 - g - h,
    y + h,
    x1 - g,
    y,
    x1 - g - h,
    y - h,
    x0 + g + h,
    y - h,
  ];
}

function vertical(x: number, y0: number, y1: number): number[] {
  const h = SEG_H;
  const g = SEG_GAP;
  return [
    x,
    y0 + g,
    x + h,
    y0 + g + h,
    x + h,
    y1 - g - h,
    x,
    y1 - g,
    x - h,
    y1 - g - h,
    x - h,
    y0 + g + h,
  ];
}

function digitRings(d: number, cx: number): Ring[] {
  const w = DIGIT_W / 2 - SEG_H;
  const t = 0.5 - SEG_H;
  const seg: Record<string, Ring> = {
    a: horizontal(cx - w, cx + w, t),
    g: horizontal(cx - w, cx + w, 0),
    d: horizontal(cx - w, cx + w, -t),
    b: vertical(cx + w, 0, t),
    c: vertical(cx + w, -t, 0),
    e: vertical(cx - w, -t, 0),
    f: vertical(cx - w, 0, t),
  };
  const on = DIGIT_SEGMENTS[d] ?? '';
  return Array.from(on, (k) => seg[k] ?? []);
}

/** 2 桁の機体番号（00〜99） */
export function numberShape(n: number): DecalShape {
  const v = Math.min(99, Math.max(0, Math.floor(n)));
  const aspect = DIGIT_W * 2 + DIGIT_GAP;
  const off = (DIGIT_W + DIGIT_GAP) / 2;
  return {
    rings: [...digitRings(Math.floor(v / 10), -off), ...digitRings(v % 10, off)],
    aspect,
    text: true,
  };
}

/** デカールの図形（number は機体番号） */
export function decalShape(id: DecalId, number: number): DecalShape {
  if (id === 'number') return numberShape(number);
  return { rings: decalRings(id), aspect: 1, text: false };
}

/** SVG の path の d（y は下向きに直す） */
export function shapePath(shape: DecalShape): string {
  return shape.rings
    .map((r) => {
      const pts: string[] = [];
      for (let i = 0; i < r.length; i += 2)
        pts.push(`${(r[i] ?? 0).toFixed(3)} ${(-(r[i + 1] ?? 0)).toFixed(3)}`);
      return `M${pts.join('L')}Z`;
    })
    .join('');
}

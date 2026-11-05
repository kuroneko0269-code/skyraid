// リングレース（7-1）のコースの道筋（Three.js 非依存）: 開始位置 → 各リングの中心を、リングの向きを接線にした
// 3 次エルミート曲線でつなぐ。ボット（tests/race-bots.ts）が追う線・9-8 の道案内の点線・コースの下見のカメラが同じ線を使う
import type { Vec3 } from '../../flight/math';
import type { RaceRing } from './course';
import type { CourseDef } from './types';

/** 道筋の点の間隔（m） */
export const PATH_SAMPLE = 10;

interface Node {
  readonly p: Readonly<Vec3>;
  readonly n: Readonly<Vec3>;
}

/** 道筋の節（0 は開始位置、i + 1 はリング i） */
function nodesOf(course: CourseDef, rings: readonly RaceRing[]): Node[] {
  const s = course.start;
  const h = (s.headingDeg * Math.PI) / 180;
  return [
    { p: { x: s.x, y: s.y, z: s.z }, n: { x: Math.sin(h), y: 0, z: -Math.cos(h) } },
    ...rings.map((r) => ({ p: r.position, n: r.normal })),
  ];
}

/** 節 a → b の曲線の t（0〜1）の点を out に書く */
function hermite(a: Node, b: Node, t: number, out: Vec3): Vec3 {
  const len = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
  const h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2;
  const h11 = t ** 3 - t ** 2;
  out.x = h00 * a.p.x + h10 * a.n.x * len + h01 * b.p.x + h11 * b.n.x * len;
  out.y = h00 * a.p.y + h10 * a.n.y * len + h01 * b.p.y + h11 * b.n.y * len;
  out.z = h00 * a.p.z + h10 * a.n.z * len + h01 * b.p.z + h11 * b.n.z * len;
  return out;
}

/**
 * コースの道筋を PATH_SAMPLE m ごとの点にする。ringIndex[i] にリング i の点の番号を書く。
 * ゴールの先はまっすぐ 600m 伸ばす（ボットの先読みの点が尽きないように）
 */
export function coursePath(
  course: CourseDef,
  rings: readonly RaceRing[],
  ringIndex: number[] = [],
): Vec3[] {
  const nodes = nodesOf(course, rings);
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
    const n = Math.max(1, Math.ceil(len / PATH_SAMPLE));
    if (i > 0) ringIndex[i - 1] = out.length;
    for (let k = 0; k < n; k++) out.push(hermite(a, b, k / n, { x: 0, y: 0, z: 0 }));
  }
  const last = nodes[nodes.length - 1];
  if (last) {
    ringIndex[nodes.length - 2] = out.length;
    out.push({ ...last.p });
    for (let k = 1; k <= 60; k++)
      out.push({
        x: last.p.x + last.n.x * k * PATH_SAMPLE,
        y: last.p.y + last.n.y * k * PATH_SAMPLE,
        z: last.p.z + last.n.z * k * PATH_SAMPLE,
      });
  }
  return out;
}

/**
 * 区間（from 番目の節 → from + 1 番目の節。節 0 は開始位置、節 i + 1 はリング i）の曲線を spacing m ごとに
 * out へ書く（out の先頭から。書いた数を返す。max まで）。道案内の点線が描画フレームごとに使う（配列は使い回す）
 */
export function sampleLeg(
  course: CourseDef,
  rings: readonly RaceRing[],
  from: number,
  spacing: number,
  out: Vec3[],
  offset: number,
  max: number,
): number {
  const a = from === 0 ? startNode(course) : ringNode(rings[from - 1]);
  const b = ringNode(rings[from]);
  if (!a || !b) return 0;
  const len = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
  // 曲がる区間は直線より長いので、点の数は直線の長さ × 1.3 で見積もる
  const n = Math.min(max - offset, Math.max(1, Math.ceil((len * 1.3) / spacing)));
  for (let k = 0; k < n; k++) {
    const o = out[offset + k];
    if (o) hermite(a, b, (k + 0.5) / n, o);
  }
  return Math.max(0, n);
}

/** 9-9b: 自機 → 次のリングの区間の節（描画フレームごとに使い回す） */
const fromP: Vec3 = { x: 0, y: 0, z: 0 };
const fromN: Vec3 = { x: 0, y: 0, z: 0 };
const fromNode: Node = { p: fromP, n: fromN };
const toNode: { p: Readonly<Vec3>; n: Readonly<Vec3> } = { p: fromP, n: fromN };

/**
 * 9-9b: 自機の位置 → リング ring の曲線（出だしはリングへまっすぐ向かい、リングの向きで入る）を spacing m ごとに out へ書く
 * （out の offset から。書いた数を返す。max まで）。自機から near m の内の点は飛ばす。道案内の点線が描画フレームごとに使う
 */
export function sampleFromPoint(
  start: Readonly<Vec3>,
  ring: RaceRing,
  spacing: number,
  out: Vec3[],
  offset: number,
  max: number,
  near: number,
): number {
  const dx = ring.position.x - start.x;
  const dy = ring.position.y - start.y;
  const dz = ring.position.z - start.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return 0;
  fromP.x = start.x;
  fromP.y = start.y;
  fromP.z = start.z;
  fromN.x = dx / len;
  fromN.y = dy / len;
  fromN.z = dz / len;
  toNode.p = ring.position;
  toNode.n = ring.normal;
  const total = Math.max(1, Math.ceil((len * 1.3) / spacing));
  let n = 0;
  for (let k = 0; k < total && offset + n < max; k++) {
    const o = out[offset + n];
    if (!o) break;
    hermite(fromNode, toNode, (k + 0.5) / total, o);
    if (Math.hypot(o.x - start.x, o.y - start.y, o.z - start.z) < near) continue;
    n++;
  }
  return n;
}

/** 9-9b: 点の列（下見の道筋）を spacing m ごとに間引いて out へ書く（書いた数を返す。max まで） */
export function samplePath(
  points: readonly Readonly<Vec3>[],
  spacing: number,
  out: Vec3[],
  max: number,
): number {
  let n = 0;
  let carried = spacing;
  for (let i = 1; i < points.length && n < max; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let d = spacing - carried;
    while (d < seg && n < max) {
      const o = out[n];
      if (!o) return n;
      const t = d / seg;
      o.x = a.x + (b.x - a.x) * t;
      o.y = a.y + (b.y - a.y) * t;
      o.z = a.z + (b.z - a.z) * t;
      n++;
      d += spacing;
    }
    carried = seg - (d - spacing);
  }
  return n;
}

function startNode(course: CourseDef): Node {
  const s = course.start;
  const h = (s.headingDeg * Math.PI) / 180;
  return { p: { x: s.x, y: s.y, z: s.z }, n: { x: Math.sin(h), y: 0, z: -Math.cos(h) } };
}

function ringNode(r: RaceRing | undefined): Node | null {
  return r ? { p: r.position, n: r.normal } : null;
}

/** 道筋の長さ（m。点の間の折れ線） */
export function pathLength(points: readonly Readonly<Vec3>[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

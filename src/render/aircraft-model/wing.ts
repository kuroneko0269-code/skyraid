// 翼（主翼・水平尾翼・垂直尾翼）: 翼型（前縁が丸く後縁が薄い対称翼）の Shape を ExtrudeGeometry で翼幅方向に押し出し、
// 台形の平面形（翼弦・後退角・上反角）へ曲げる。押し出しの両端（付け根・翼端）は面取り（bevel）で丸める
import { BufferAttribute, ExtrudeGeometry, Shape, type BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftShape, WingShape } from '../../data/aircraft-shapes';
import type { MeshAccumulator, Rgb } from './accumulator';
import { finSection, wingSection, type WingSection } from './planform';

/** NACA 00xx の半分の厚さ（翼弦 1 あたり）。後縁は閉じる形 */
function halfThickness(x: number, t: number): number {
  const s = Math.sqrt(Math.max(0, x));
  return 5 * t * (0.2969 * s - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}

/** 翼弦の x0〜x1 の部分の翼型（x0 > 0・x1 < 1 なら前・後ろは平らな切り口）。points は片面の点の数 */
function airfoilShape(x0: number, x1: number, t: number, points: number): Shape {
  const minHalf = 0.004;
  const xs: number[] = [];
  for (let k = 0; k <= points; k++) {
    // 前縁（x0 = 0）の丸みに点を寄せる
    const f = x0 === 0 ? (1 - Math.cos((Math.PI * k) / points)) / 2 : k / points;
    xs.push(x0 + (x1 - x0) * f);
  }
  const shape = new Shape();
  xs.forEach((x, i) => {
    const y = Math.max(halfThickness(x, t), x === 0 ? 0 : minHalf);
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i] ?? 0;
    const y = Math.max(halfThickness(x, t), x === 0 ? 0 : minHalf);
    if (x === 0) continue;
    shape.lineTo(x, -y);
  }
  return shape;
}

export type WingKind = 'wing' | 'stabilizer' | 'fin';

export interface PanelSpec {
  readonly kind: WingKind;
  /** 翼幅（垂直尾翼は高さ）の割合の範囲 */
  readonly u0: number;
  readonly u1: number;
  /** 翼弦の割合の範囲 */
  readonly x0: number;
  readonly x1: number;
  /** -1 = 左、+1 = 右 */
  readonly side: -1 | 1;
  readonly color: Rgb;
  readonly part: number;
}

export interface WingBuildOptions {
  readonly airfoilPoints: number;
  readonly bevelSegments: number;
  readonly bevel: number;
}

function sectionOf(shape: Readonly<AircraftShape>, kind: WingKind, u: number): WingSection {
  if (kind === 'fin') return finSection(shape, u);
  return wingSection(shape, kind === 'wing' ? shape.wing : shape.stabilizer, u);
}

function wingOf(shape: Readonly<AircraftShape>, kind: WingKind): WingShape {
  return kind === 'wing' ? shape.wing : kind === 'stabilizer' ? shape.stabilizer : shape.fin;
}

/** UV のアトラス: 主翼は v 0.5〜0.75、尾翼は v 0.75〜1 の左半分（u = 翼幅、v = 翼弦） */
function panelUv(kind: WingKind, u: number, x: number): [number, number] {
  const cu = Math.min(1, Math.max(0, u));
  const cx = Math.min(1, Math.max(0, x));
  if (kind === 'wing') return [cu, 0.5 + 0.25 * cx];
  return [0.5 * cu, 0.75 + 0.25 * cx];
}

/** 翼の 1 枚（翼幅 u0〜u1・翼弦 x0〜x1）を acc に積む */
export function addWingPanel(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  p: Readonly<PanelSpec>,
  o: Readonly<WingBuildOptions>,
): void {
  const w = wingOf(shape, p.kind);
  const spanLength = p.kind === 'fin' ? w.span : w.span / 2;
  const depth = (p.u1 - p.u0) * spanLength;
  const rootChord = sectionOf(shape, p.kind, p.u0).chord;
  const bevel = o.bevelSegments > 0;
  const g = new ExtrudeGeometry(airfoilShape(p.x0, p.x1, w.thickness, o.airfoilPoints), {
    depth,
    steps: 1,
    bevelEnabled: bevel,
    bevelThickness: o.bevel,
    // 翼型の輪郭を外へ広げる量（翼弦 1 あたり）。大きいと後縁が厚くなるので 1 cm 程度に抑える
    bevelSize: Math.min(o.bevel / rootChord, 0.003),
    bevelSegments: o.bevelSegments,
  });
  g.deleteAttribute('normal');
  const pos = g.getAttribute('position');
  const uvs = new Float32Array(pos.count * 2);
  const cant = p.kind === 'fin' ? (w.dihedralDeg * Math.PI) / 180 : 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = p.u0 + pos.getZ(i) / spanLength;
    const s = sectionOf(shape, p.kind, u);
    const [tu, tv] = panelUv(p.kind, u, x);
    uvs[i * 2] = tu;
    uvs[i * 2 + 1] = tv;
    let wx: number;
    let wy: number;
    if (p.kind === 'fin') {
      // 厚みは尾翼の面に垂直（外へ傾けた分だけ回す）
      wx = s.x + y * s.chord * Math.cos(cant);
      wy = s.y - y * s.chord * Math.sin(cant);
    } else {
      wx = s.x;
      wy = s.y + y * s.chord;
    }
    pos.setXYZ(i, wx * p.side, wy, s.z + x * s.chord);
  }
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  const merged = mergeVertices(g, 1e-5);
  g.dispose();
  // 押し出しの軸の入れ替え（翼弦 x ⇄ 翼幅 z）は鏡映なので右の主翼・尾翼は裏返る。左は x の反転で元に戻る。
  // 垂直尾翼の入れ替えは回転なので、左（x の反転）だけ裏返る
  if (p.kind === 'fin' ? p.side === -1 : p.side === 1) flipWinding(merged);
  merged.computeVertexNormals();
  acc.addGeometry(merged, p.color, p.part, null);
}

function flipWinding(g: BufferGeometry): void {
  const index = g.getIndex();
  if (!index) return;
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
  index.needsUpdate = true;
}

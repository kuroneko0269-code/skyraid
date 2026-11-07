// 10-4a: メカ怪獣ゴウライの形の部品: 面ごとに法線を分けた多角形・6 面体・箱・円柱（KaijuMeshBuilder に積む）。
// 機械らしい角のはっきりした見た目にする（面の法線は形の中心から外向きに揃える）
import { Vector3 } from 'three';
import type { BoneBind, KaijuMeshBuilder, Rgb } from '../kaiju-model/builder';

export const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

const e1 = new Vector3();
const e2 = new Vector3();
const nrm = new Vector3();
const mid = new Vector3();

/** 平らな多角形（点は周の順。法線は ref から外向きに揃える） */
function face(
  b: KaijuMeshBuilder,
  pts: readonly Vector3[],
  ref: Readonly<Vector3>,
  color: Rgb,
  bone: BoneBind,
  glow: number,
): void {
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];
  if (!p0 || !p1 || !p2) return;
  e1.subVectors(p1, p0);
  e2.subVectors(p2, p0);
  nrm.crossVectors(e1, e2);
  if (nrm.lengthSq() < 1e-12) return;
  nrm.normalize();
  mid.set(0, 0, 0);
  for (const p of pts) mid.add(p);
  mid.multiplyScalar(1 / pts.length).sub(ref);
  const flip = nrm.dot(mid) < 0;
  if (flip) nrm.negate();
  const idx = pts.map((p) => b.vertex(p, nrm, color, bone, glow));
  for (let i = 1; i < idx.length - 1; i++) {
    const a = idx[0] ?? 0;
    const c = idx[i] ?? 0;
    const d = idx[i + 1] ?? 0;
    if (flip) b.triangle(a, d, c);
    else b.triangle(a, c, d);
  }
}

/** 6 面体（下の 4 点・上の 4 点をそれぞれ周の順に）。面ごとに法線を分ける */
export function hexa(
  b: KaijuMeshBuilder,
  c: readonly Vector3[],
  color: Rgb,
  bone: BoneBind,
  glow = 0,
  faceGlow?: number[],
): void {
  const ref = new Vector3();
  for (const p of c) ref.add(p);
  ref.multiplyScalar(1 / c.length);
  const F = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  F.forEach((f, i) => {
    const pts = f.map((k) => c[k] ?? ref);
    face(b, pts, ref, color, bone, faceGlow?.[i] ?? glow);
  });
}

/** 軸に沿った箱（x0〜x1・y0〜y1・z0〜z1） */
export function box(
  b: KaijuMeshBuilder,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: Rgb,
  bone: BoneBind,
  glow = 0,
): void {
  hexa(
    b,
    [
      v(x0, y0, z0),
      v(x1, y0, z0),
      v(x1, y0, z1),
      v(x0, y0, z1),
      v(x0, y1, z0),
      v(x1, y1, z0),
      v(x1, y1, z1),
      v(x0, y1, z1),
    ],
    color,
    bone,
    glow,
  );
}

/** 左右に対称な箱（x は正の側を渡す。左は −x） */
export function boxPair(
  b: KaijuMeshBuilder,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: Rgb,
  bone: BoneBind,
): void {
  box(b, x0, x1, y0, y1, z0, z1, color, bone);
  box(b, -x1, -x0, y0, y1, z0, z1, color, bone);
}

const axis = new Vector3();
const side = new Vector3();
const up = new Vector3();

/** 円柱（底 base から先 tip へ。半径 r0 → r1・側面 sides）。先のふたは tipGlow で光らせられる */
export function cylinder(
  b: KaijuMeshBuilder,
  base: Readonly<Vector3>,
  tip: Readonly<Vector3>,
  r0: number,
  r1: number,
  sides: number,
  color: Rgb,
  bone: BoneBind,
  tipColor: Rgb = color,
  tipGlow = 0,
): void {
  axis.subVectors(tip, base).normalize();
  up.set(0, 1, 0);
  if (Math.abs(axis.dot(up)) > 0.9) up.set(1, 0, 0);
  side.crossVectors(up, axis).normalize();
  up.crossVectors(axis, side).normalize();
  const ring = (c: Readonly<Vector3>, r: number): Vector3[] =>
    Array.from({ length: sides }, (_, j) => {
      const a = (j / sides) * Math.PI * 2;
      return new Vector3()
        .copy(c)
        .addScaledVector(side, Math.cos(a) * r)
        .addScaledVector(up, Math.sin(a) * r);
    });
  const r0s = ring(base, r0);
  const r1s = ring(tip, r1);
  const ref = new Vector3().addVectors(base, tip).multiplyScalar(0.5);
  for (let j = 0; j < sides; j++) {
    const k = (j + 1) % sides;
    const a0 = r0s[j];
    const a1 = r0s[k];
    const b1 = r1s[k];
    const b0 = r1s[j];
    if (a0 && a1 && b1 && b0) face(b, [a0, a1, b1, b0], ref, color, bone, 0);
  }
  face(b, r0s, ref, color, bone, 0);
  face(b, r1s, ref, tipColor, bone, tipGlow);
}

/** 胴（動かない所。骨は root） */

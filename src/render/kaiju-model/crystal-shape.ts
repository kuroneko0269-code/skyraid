// 結晶の塊の部品（6-1b）。背中の一列の棘をやめ、肩・首の付け根・前腕の外側に不規則な塊で置く
import { Vector3 } from 'three';
import type { BoneBind, KaijuMeshBuilder, Rgb } from './builder';

/**
 * 結晶（6-1b）: 六角柱（sides 角）の先を角錐でとがらせた形。面ごとの法線で角を立てる。
 * aGlow は内側の光の強さ（根元 core → 先端 core × 0.35。結晶のマテリアルが読む）
 */
export function addCrystal(
  m: KaijuMeshBuilder,
  base: Readonly<Vector3>,
  tip: Readonly<Vector3>,
  radius: number,
  sides: number,
  color: Rgb,
  bone: BoneBind,
  core: number,
  twist = 0,
): void {
  const dir = new Vector3().subVectors(tip, base);
  const len = dir.length();
  dir.normalize();
  const upv = new Vector3(0, 1, 0);
  if (Math.abs(dir.dot(upv)) > 0.92) upv.set(1, 0, 0);
  const side = new Vector3().crossVectors(upv, dir).normalize();
  upv.crossVectors(dir, side).normalize();
  const shoulder = new Vector3().copy(base).addScaledVector(dir, len * 0.68);
  const ring = (center: Vector3, r: number, j: number): Vector3 => {
    const t = (j / sides) * Math.PI * 2 + twist;
    return new Vector3()
      .copy(center)
      .addScaledVector(side, Math.sin(t) * r)
      .addScaledVector(upv, Math.cos(t) * r);
  };
  const b = new Vector3().copy(base);
  const tipCore = core * 0.35;
  const midCore = core * 0.6;
  for (let j = 0; j < sides; j++) {
    const b0 = ring(b, radius, j);
    const b1 = ring(b, radius, j + 1);
    const s0 = ring(shoulder, radius * 0.92, j);
    const s1 = ring(shoulder, radius * 0.92, j + 1);
    // 柱の側面（四角 = 三角 2 枚）
    const n1 = new Vector3()
      .crossVectors(new Vector3().subVectors(b1, b0), new Vector3().subVectors(s0, b0))
      .normalize();
    if (n1.dot(new Vector3().subVectors(b0, b)) < 0) n1.negate();
    const a0 = m.vertex(b0, n1, color, bone, core);
    const a1 = m.vertex(b1, n1, color, bone, core);
    const a2 = m.vertex(s1, n1, color, bone, midCore);
    const a3 = m.vertex(s0, n1, color, bone, midCore);
    // 巻き順を外向きの法線にそろえる
    const g1 = new Vector3().crossVectors(
      new Vector3().subVectors(b1, b0),
      new Vector3().subVectors(s1, b0),
    );
    if (g1.dot(n1) >= 0) {
      m.triangle(a0, a1, a2);
      m.triangle(a0, a2, a3);
    } else {
      m.triangle(a0, a2, a1);
      m.triangle(a0, a3, a2);
    }
    // 先の角錐
    const n2 = new Vector3()
      .crossVectors(new Vector3().subVectors(s1, s0), new Vector3().subVectors(tip, s0))
      .normalize();
    if (n2.dot(new Vector3().subVectors(s0, shoulder)) < 0) n2.negate();
    const c0 = m.vertex(s0, n2, color, bone, midCore);
    const c1 = m.vertex(s1, n2, color, bone, midCore);
    const c2 = m.vertex(tip, n2, color, bone, tipCore);
    const g2 = new Vector3().crossVectors(
      new Vector3().subVectors(s1, s0),
      new Vector3().subVectors(tip, s0),
    );
    if (g2.dot(n2) >= 0) m.triangle(c0, c1, c2);
    else m.triangle(c0, c2, c1);
  }
}

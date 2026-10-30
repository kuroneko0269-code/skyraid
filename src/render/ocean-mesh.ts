// 海面のメッシュ（4-2）。画質「中」以上はカメラ中心の同心リング（近くは細かく遠くは粗い）、
// 「低」は従来どおりの正方形の平面
import { BufferAttribute, BufferGeometry, PlaneGeometry } from 'three';

/**
 * 同心リングの半径。inner から outer まで、隣の輪との間隔が円周方向の間隔（2πr / segments）と
 * ほぼ同じになる等比数列（最後は outer ちょうど）。最初の要素は inner
 */
export function ringRadii(inner: number, outer: number, segments: number): number[] {
  const ratio = 1 + (2 * Math.PI) / segments;
  const count = Math.max(1, Math.ceil(Math.log(outer / inner) / Math.log(ratio)));
  const step = Math.pow(outer / inner, 1 / count);
  const radii: number[] = [];
  for (let i = 0; i <= count; i++) radii.push(inner * Math.pow(step, i));
  return radii;
}

/** 中心の 1 点 + 同心リングの格子（xz 平面、y = 0）。中心は扇形でつなぐ */
export function createRingGeometry(inner: number, outer: number, segments: number): BufferGeometry {
  const radii = ringRadii(inner, outer, segments);
  const rings = radii.length;
  const positions = new Float32Array((1 + rings * segments) * 3);
  let p = 3;
  for (const r of radii) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions[p++] = Math.cos(a) * r;
      positions[p++] = 0;
      positions[p++] = Math.sin(a) * r;
    }
  }
  const indices: number[] = [];
  // 中心の扇（上から見て反時計回り = 表が上）
  for (let s = 0; s < segments; s++) indices.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let i = 0; i + 1 < rings; i++) {
    const a = 1 + i * segments;
    const b = a + segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      indices.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** 画質「低」の平面（一辺 size、segments 分割、xz 平面） */
export function createPlaneGeometry(size: number, segments: number): BufferGeometry {
  const geometry = new PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

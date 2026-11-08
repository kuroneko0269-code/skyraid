// 10-5a: UFO ゼノリスの体の当たり（Three.js 非依存・決まった計算）: 円盤（水平に平たい楕円体）と上のドーム（球）。形は縦の軸の周りに
// 対称なので、体の向き（方位）と見た目の傾き・回転は入れない。体も速く動く（巡航 150・急加速 320 m/s）ので、体から見た自機の動き
// （前の位置どうし → 今の位置どうしの差）を細かく調べ、すり抜けない。結果はアルビオン・ゴウライと同じ形（弾くのは albion-bounce.ts）
import { XENOLITH_CONFIG as C } from '../data/xenolith';
import type { Vec3 } from '../flight/math';
import type { HullContact, HullHit } from './albion-hull';

const H = C.collision;
/** 体の半径より遠ければ調べない（m） */
const FAR = H.discA + 20;

/** 体の中心からの点 (x, y, z) のめり込み（余裕 margin）。めり込んでいれば out に深さと外向きを入れる */
export function xenolithPenetrationLocal(
  x: number,
  y: number,
  z: number,
  margin: number,
  out: HullHit,
): boolean {
  let hit = false;
  let best = Infinity;
  // 円盤: 楕円体（水平 A・上下 B）
  const A = H.discA + margin;
  const B = H.discB + margin;
  const q = Math.sqrt((x * x + z * z) / (A * A) + (y * y) / (B * B));
  if (q < 1) {
    const len = Math.hypot(x, y, z);
    const depth = q > 1e-6 ? Math.min(B, len * (1 / q - 1)) : B;
    let nx = x / (A * A);
    let ny = y / (B * B);
    let nz = z / (A * A);
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-9) {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    } else {
      nx = 0;
      ny = 1;
      nz = 0;
    }
    best = depth;
    hit = true;
    out.depth = depth;
    out.normal.x = nx;
    out.normal.y = ny;
    out.normal.z = nz;
    out.shape = 'body';
  }
  // ドーム: 球
  const dy = y - H.domeUp;
  const R = H.domeR + margin;
  const dl = Math.hypot(x, dy, z);
  if (dl < R && R - dl < best) {
    hit = true;
    out.depth = R - dl;
    if (dl > 1e-6) {
      out.normal.x = x / dl;
      out.normal.y = dy / dl;
      out.normal.z = z / dl;
    } else {
      out.normal.x = 0;
      out.normal.y = 1;
      out.normal.z = 0;
    }
    out.shape = 'body';
  }
  return hit;
}

/**
 * 自機の動き aPrev → aNow が、体（bodyPrev → bodyNow と動いた）にめり込んだか。体から見た相対の線分を step m ごとに調べ、
 * 最初にめり込んだ点（今の体の位置に足した世界の位置）・深さ・外向きを out に入れて true
 */
export function xenolithContact(
  bodyPrev: Readonly<Vec3>,
  bodyNow: Readonly<Vec3>,
  aPrev: Readonly<Vec3>,
  aNow: Readonly<Vec3>,
  margin: number,
  step: number,
  out: HullContact,
): boolean {
  const x0 = aPrev.x - bodyPrev.x;
  const y0 = aPrev.y - bodyPrev.y;
  const z0 = aPrev.z - bodyPrev.z;
  const x1 = aNow.x - bodyNow.x;
  const y1 = aNow.y - bodyNow.y;
  const z1 = aNow.z - bodyNow.z;
  const far = FAR + margin;
  if (Math.hypot(x0, y0, z0) > far && Math.hypot(x1, y1, z1) > far) {
    // 両端が遠くても、線分が体の近くを通るなら調べる（相対の動きが大きいとき）
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(x0 * dx + y0 * dy + z0 * dz) / l2)) : 0;
    if (Math.hypot(x0 + dx * t, y0 + dy * t, z0 + dz * t) > far) return false;
  }
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, step)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;
    if (xenolithPenetrationLocal(x, y, z, margin, out)) {
      out.point.x = bodyNow.x + x;
      out.point.y = bodyNow.y + y;
      out.point.z = bodyNow.z + z;
      return true;
    }
  }
  return false;
}

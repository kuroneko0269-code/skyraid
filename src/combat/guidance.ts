// ミサイルの誘導と信管の幾何（Three.js 非依存）
import type { Vec3 } from '../flight/math';
import type { HomingTarget } from './missile';

/**
 * 比例航法の簡易版: 視線（ミサイル → 目標）の角速度 ω = (r × v_rel) / |r|² に航法定数 N を掛けた
 * 角速度で速度の向きを回す。向きに沿った成分は除き、大きさは maxTurn（rad/s）で頭打ち。
 * dir（単位ベクトル）を dt 秒分回して out に書く。回した角度は atan(|Ω| dt) ≤ maxTurn × dt
 */
export function proportionalNavigation(
  out: Vec3,
  dir: Readonly<Vec3>,
  missileVelocity: Readonly<Vec3>,
  missilePos: Readonly<Vec3>,
  target: HomingTarget,
  navConstant: number,
  maxTurn: number,
  dt: number,
): Vec3 {
  const rx = target.position.x - missilePos.x;
  const ry = target.position.y - missilePos.y;
  const rz = target.position.z - missilePos.z;
  const vx = target.velocity.x - missileVelocity.x;
  const vy = target.velocity.y - missileVelocity.y;
  const vz = target.velocity.z - missileVelocity.z;
  const r2 = rx * rx + ry * ry + rz * rz;
  if (r2 === 0) return copy(out, dir);
  let wx = (navConstant * (ry * vz - rz * vy)) / r2;
  let wy = (navConstant * (rz * vx - rx * vz)) / r2;
  let wz = (navConstant * (rx * vy - ry * vx)) / r2;
  const along = wx * dir.x + wy * dir.y + wz * dir.z;
  wx -= along * dir.x;
  wy -= along * dir.y;
  wz -= along * dir.z;
  const w = Math.hypot(wx, wy, wz);
  if (w > maxTurn) {
    const k = maxTurn / w;
    wx *= k;
    wy *= k;
    wz *= k;
  }
  // d' = d + (Ω × d) dt を正規化
  const nx = dir.x + (wy * dir.z - wz * dir.y) * dt;
  const ny = dir.y + (wz * dir.x - wx * dir.z) * dt;
  const nz = dir.z + (wx * dir.y - wy * dir.x) * dt;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

/** 線分 a→b 上で点 c に最も近い位置（0〜1） */
export function closestOnSegment(a: Readonly<Vec3>, b: Readonly<Vec3>, c: Readonly<Vec3>): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 === 0) return 0;
  const t = ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function copy(out: Vec3, v: Readonly<Vec3>): Vec3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

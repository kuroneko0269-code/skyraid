// 機銃の予測照準点（Three.js 非依存）: 対象の速度と弾速から「機首をここへ向けて撃てば当たる」点を求める
import type { Vec3 } from '../flight/math';

/**
 * 弾（発射点 from から一定の速さ bulletSpeed で直進、重力 gravity で落ちる）が、等速で動く対象
 * （位置 targetPos・速度 targetVel）に当たる時間 t を求め、照準点 = 対象の t 秒後の位置 + 落下分の持ち上げ
 * （g t² / 2）を out に書く。当たる時間が無い・maxTime を超えるなら -1（out は書かない）。
 *
 * |D + V t| = s t（D = 対象 − 発射点）を t について解く: (V·V − s²) t² + 2 (D·V) t + D·D = 0
 */
export function leadPoint(
  out: Vec3,
  from: Readonly<Vec3>,
  bulletSpeed: number,
  targetPos: Readonly<Vec3>,
  targetVel: Readonly<Vec3>,
  gravity: number,
  maxTime: number,
): number {
  const dx = targetPos.x - from.x;
  const dy = targetPos.y - from.y;
  const dz = targetPos.z - from.z;
  const v = targetVel;
  const a = v.x * v.x + v.y * v.y + v.z * v.z - bulletSpeed * bulletSpeed;
  const b = 2 * (dx * v.x + dy * v.y + dz * v.z);
  const c = dx * dx + dy * dy + dz * dz;
  const t = smallestPositiveRoot(a, b, c);
  if (t < 0 || t > maxTime) return -1;
  out.x = targetPos.x + v.x * t;
  out.y = targetPos.y + v.y * t + 0.5 * gravity * t * t;
  out.z = targetPos.z + v.z * t;
  return t;
}

/** a t² + b t + c = 0 の最小の正の解。無ければ -1 */
function smallestPositiveRoot(a: number, b: number, c: number): number {
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return -1;
    const t = -c / b;
    return t > 0 ? t : -1;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  if (lo > 0) return lo;
  if (hi > 0) return hi;
  return -1;
}

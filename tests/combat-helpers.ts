// ミサイル・フレア・予測照準のテストで使う小道具
import type { Shooter } from '../src/combat/gun';
import type { FuseTarget } from '../src/combat/missile';
import type { Quat, Vec3 } from '../src/flight/math';

export const DT = 1 / 60;
export const DEG = Math.PI / 180;
export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** 機首（-Z）を dir へ向ける姿勢 */
export function lookQuat(dir: Vec3): Quat {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  // -Z → d の最短回転: 軸 = (-Z) × d、w = 1 + (-Z)·d
  const q = { x: d.y, y: -d.x, z: 0, w: 1 - d.z };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

export function shooter(speed = 250, orientation: Quat = IDENTITY, y = 0): Shooter {
  return { position: { x: 0, y, z: 0 }, orientation, speed };
}

export function point(
  x: number,
  y: number,
  z: number,
  hitRadius = 7,
): FuseTarget & { position: Vec3; velocity: Vec3; active: boolean } {
  return { position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 }, hitRadius, active: true };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const c =
    (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

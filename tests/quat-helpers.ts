// 通信のテストの共通部分（6-6 で net-protocol.test.ts から分けた）: 決定的な乱数・ランダムな姿勢・回転の角度差
import { normalizeQuat, type Quat } from '../src/flight/math';

/** 決定的な乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomQuat(r: () => number): Quat {
  return normalizeQuat({ x: r() * 2 - 1, y: r() * 2 - 1, z: r() * 2 - 1, w: r() * 2 - 1 });
}

/** 2 つの回転の角度差（度）。q と -q は同じ回転 */
export function angleDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

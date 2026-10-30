// ロケット・爆弾（2-6）で共通の弾 1 発と、重力だけで飛ぶ弾の 1 ステップ（Three.js 非依存）。
// 位置の更新は等加速度の厳密な式（p += v dt − g dt² / 2）なので、何ステップに分けても同じ放物線の上に乗る
// （爆弾の着弾予測点と実際の着弾が一致する）
import { segmentSphere } from './collision';
import type { GroundHeightFn } from './gun';
import type { CombatTarget } from './target';

/** 弾 1 発。p* は前ステップの位置（当たり判定の線分の始点、描画の補間） */
export interface Projectile {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
}

/** 着弾の情報（使い回すので保持しないこと）。target は当たった対象（地面なら null） */
export interface Impact {
  x: number;
  y: number;
  z: number;
  target: CombatTarget | null;
}

export function newProjectile(): Projectile {
  return { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, age: 0 };
}

/** 重力 gravity で dt 秒進める */
export function moveBallistic(p: Projectile, gravity: number, dt: number): void {
  p.px = p.x;
  p.py = p.y;
  p.pz = p.z;
  p.x += p.vx * dt;
  p.y += p.vy * dt - 0.5 * gravity * dt * dt;
  p.z += p.vz * dt;
  p.vy -= gravity * dt;
  p.age += dt;
}

/**
 * 前ステップ → 今の線分で、対象（team が owner と違い active なもの）の球と地面への当たりを調べ、
 * 当たれば out に書いて true。対象が先、次に地面（線分の終点が地表以下なら、線分を地形が線形とみなして詰める）
 */
export function findImpact(
  p: Readonly<Projectile>,
  targets: readonly CombatTarget[],
  isHostile: (t: CombatTarget) => boolean,
  groundHeight: GroundHeightFn | null,
  out: Impact,
): boolean {
  let best = 2;
  let bestTarget: CombatTarget | null = null;
  for (const t of targets) {
    if (!t.active || !isHostile(t)) continue;
    const c = t.position;
    const s = segmentSphere(p.px, p.py, p.pz, p.x, p.y, p.z, c.x, c.y, c.z, t.hitRadius);
    if (s >= 0 && s < best) {
      best = s;
      bestTarget = t;
    }
  }
  if (!bestTarget && groundHeight) {
    const g = groundHeight(p.x, p.z);
    if (p.y <= g) {
      const above = p.py - groundHeight(p.px, p.pz);
      best = above > 0 ? above / (above - (p.y - g)) : 0;
    }
  }
  if (best > 1) return false;
  out.target = bestTarget;
  out.x = p.px + (p.x - p.px) * best;
  out.y = p.py + (p.y - p.py) * best;
  out.z = p.pz + (p.z - p.pz) * best;
  return true;
}

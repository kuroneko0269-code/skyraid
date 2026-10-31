// 協力のレイドの PvpArena の部品（6-2。pvp-arena.ts から分けた）: スタン中の操作、怪獣の部位のロックの見直しと
// ミサイルの範囲ダメージ。Three.js 非依存
import type { MissileSpec } from '../data/weapons';
import type { KaijuPart } from '../entities/kaiju-part';
import { splashDamage, type Detonation } from './missile';
import { nearestPerGroup } from './target';
import type { PvpFighter } from './pvp-fighter';
import { inCone } from './targeting';
import type { Vec3 } from '../flight/math';

/** ミサイルの信管・誘導の対象: 機体か怪獣の部位 */
export type ArenaFuseTarget = PvpFighter | KaijuPart;

/** スタン中の操作（操縦・射撃なし。オートレベルと反転の設定はそのまま） */
export const NEUTRAL = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };

/** ミサイルの発射で、ロックした部位が円錐（+ 余裕）の中か見直す。外れていれば null（無誘導） */
export function lockablePart(
  part: KaijuPart,
  from: Readonly<Vec3>,
  forward: Readonly<Vec3>,
  range: number,
  coneDeg: number,
): KaijuPart | null {
  return part.active && inCone(from, forward, part.position, range, coneDeg) ? part : null;
}

/** 爆心から半径以内の部位のうち、最も近い 1 つに撃った人の ID 付きで範囲ダメージ */
export function splashKaijuParts(
  parts: readonly KaijuPart[],
  d: Readonly<Detonation<unknown>>,
  spec: MissileSpec,
): void {
  if (parts.length === 0) return;
  const list: KaijuPart[] = [];
  const dist: number[] = [];
  for (const p of parts) {
    if (!p.active) continue;
    const q = p.position;
    const r = Math.hypot(q.x - d.x, q.y - d.y, q.z - d.z) - p.hitRadius;
    if (r >= spec.blastRadius) continue;
    list.push(p);
    dist.push(r);
  }
  for (const p of nearestPerGroup(list, dist, [])) {
    p.damageBy(splashDamage(spec, dist[list.indexOf(p)] ?? 0), d.owner);
  }
}

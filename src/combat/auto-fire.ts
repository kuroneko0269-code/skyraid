// 自動射撃（9-3、Three.js 非依存）: 選んだ対象の予測照準点（機銃の射程内のときだけ有効）が、機首から見て当たる範囲
// （的の半径 × 判定の拡大 / 距離 の角度 × scale）の中にあるか。数値は src/data/assist.ts の AUTO_FIRE_CONFIG
import { AUTO_FIRE_CONFIG } from '../data/assist';
import { inverseRotateVec3, type Quat, type Vec3 } from '../flight/math';
import type { CombatTarget } from './target';

const local: Vec3 = { x: 0, y: 0, z: 0 };

/** 撃つ条件を満たすか。lead は予測照準点（leadValid が false なら撃たない）、hitRadiusScale は機銃の判定の拡大 */
export function autoFireReady(
  target: Readonly<Pick<CombatTarget, 'active' | 'hitRadius'>> | null,
  lead: Readonly<Vec3>,
  leadValid: boolean,
  position: Readonly<Vec3>,
  orientation: Readonly<Quat>,
  hitRadiusScale: number,
  scale: number = AUTO_FIRE_CONFIG.hitConeScale,
): boolean {
  if (!target?.active || !leadValid) return false;
  local.x = lead.x - position.x;
  local.y = lead.y - position.y;
  local.z = lead.z - position.z;
  inverseRotateVec3(local, orientation, local);
  // 機首は -Z
  const ahead = -local.z;
  if (ahead <= 0) return false;
  const side = Math.hypot(local.x, local.y);
  const dist = Math.hypot(side, ahead);
  const angle = Math.atan2(side, ahead);
  return angle <= Math.atan2(target.hitRadius * hitRadiusScale, dist) * scale;
}

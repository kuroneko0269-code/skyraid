// 追い越しの数え方（9-5b。Three.js 非依存）: 練習場の結果（aim-stats.ts）と 9-1 の解析（scripts/replay-analysis/metrics.ts）で共通。
// 選んだ対象が「機銃の射程内・機首から ARM_DEG 以内」に入ったあと、同じ対象のまま射程内で機首から PASS_DEG より後ろへ回ったら 1 回
// （詰める速さが大きすぎて前を通り過ぎた）。対象が変わる・落ちる・射程の外へ離れると数え直す
import type { CombatTarget } from '../../combat/target';
import { GUN_CONFIG } from '../../data/weapons';
import { inverseRotateVec3, vec3, type Quat, type Vec3 } from '../../flight/math';

const DEG = 180 / Math.PI;
/** 前にいる（数え始める）: 機首からの角度 */
const ARM_DEG = 30;
/** 後ろへ回った: 機首からの角度 */
const PASS_DEG = 90;

export class OvertakeCounter {
  count = 0;
  private armed: CombatTarget | null = null;
  private readonly local: Vec3 = vec3();

  /** 固定ステップを進めた後に 1 回（自機が出ているときだけ） */
  step(target: CombatTarget | null, position: Readonly<Vec3>, orientation: Readonly<Quat>): void {
    if (!target || !target.active) {
      this.armed = null;
      return;
    }
    const l = this.local;
    l.x = target.position.x - position.x;
    l.y = target.position.y - position.y;
    l.z = target.position.z - position.z;
    const distance = Math.hypot(l.x, l.y, l.z);
    inverseRotateVec3(l, orientation, l);
    const angle = Math.atan2(Math.hypot(l.x, l.y), -l.z) * DEG;
    if (distance > GUN_CONFIG.range) {
      this.armed = null;
      return;
    }
    if (this.armed !== target) this.armed = null;
    if (angle <= ARM_DEG) this.armed = target;
    else if (angle > PASS_DEG && this.armed === target) {
      this.count++;
      this.armed = null;
    }
  }
}

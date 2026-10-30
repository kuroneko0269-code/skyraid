// 護衛（2-5）: group の輸送機が destination（水平の円）に入れば達成。進み具合は経路の進み具合（%）。
// 輸送機を失ったときの失敗は、失敗条件「護衛対象の喪失」（MissionWorld.escortLost）でランナーが判定する
import type { EscortObjective as EscortDef } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';

export class EscortObjective extends Objective<EscortDef> {
  readonly target = 100;

  step(world: MissionWorld): void {
    const e = world.escort(this.def.group);
    if (!e?.active) return;
    const d = this.def.destination;
    if (Math.hypot(e.position.x - d.x, e.position.z - d.z) <= d.radius) {
      this.setProgress(this.target);
      return;
    }
    // 着くまでは 99% で止める（100% は「着いた」の意味）
    this.setProgress(Math.min(this.target - 1, Math.floor(e.progress * 100)));
  }
}

// 怪獣（2-5）: 怪獣の全体の HP の damageRatio を削れば達成（怪獣は自分で撤退する）。進み具合は削った割合（%）。
// 部位 HP（頭・背・脚・尾）はフェーズ6
import type { KaijuObjective as KaijuDef } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';

export class KaijuObjective extends Objective<KaijuDef> {
  readonly target: number;

  constructor(def: KaijuDef) {
    super(def);
    this.target = Math.round(def.damageRatio * 100);
  }

  step(world: MissionWorld): void {
    if (world.kaijuDamageRatio >= this.def.damageRatio - 1e-9) {
      this.setProgress(this.target);
      return;
    }
    this.setProgress(Math.min(this.target - 1, Math.floor(world.kaijuDamageRatio * 100 + 1e-9)));
  }
}

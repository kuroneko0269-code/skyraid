// 破壊（2-5）: group の地上目標を count 個壊す（出現物の数と同じにすれば「全部」）。
// 地上目標は src/entities/ground-target.ts（2-6）
import type { DestroyObjective as DestroyDef } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';

export class DestroyObjective extends Objective<DestroyDef> {
  readonly target: number;
  /** 目標が始まったときの破壊数（それより前は数えない） */
  private base = 0;

  constructor(def: DestroyDef) {
    super(def);
    this.target = def.count;
  }

  protected override onActivate(world: MissionWorld): void {
    this.base = world.destroyedCount('groundTarget', this.def.group);
  }

  step(world: MissionWorld): void {
    this.setProgress(world.destroyedCount('groundTarget', this.def.group) - this.base);
  }
}

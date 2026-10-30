// 撃墜数（2-4）: 指定の種類（とグループ）を、目標が始まってから count 機落とす
import type { KillObjective } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';

export class KillCountObjective extends Objective<KillObjective> {
  readonly target: number;
  /** 目標が始まったときの撃墜数（それより前の撃墜は数えない） */
  private base = 0;

  constructor(def: KillObjective) {
    super(def);
    this.target = def.count;
  }

  protected override onActivate(world: MissionWorld): void {
    this.base = world.destroyedCount(this.def.target, this.def.group);
  }

  step(world: MissionWorld): void {
    this.setProgress(world.destroyedCount(this.def.target, this.def.group) - this.base);
  }
}

// 破壊（2-6 で実装）。今は型と空の実装だけで、達成しない
import type { DestroyObjective } from '../types';
import { Objective } from './objective';

export class DestroyObjectiveStub extends Objective<DestroyObjective> {
  readonly target: number;

  constructor(def: DestroyObjective) {
    super(def);
    this.target = def.count;
  }

  step(): void {
    // 2-6 で地上目標の破壊数を数える（MissionWorld.destroyedCount('groundTarget', group)）
  }
}

// 護衛（2-5 で実装）。今は型と空の実装だけで、達成しない（失敗条件「護衛対象の喪失」は MissionWorld.escortLost）
import type { EscortObjective } from '../types';
import { Objective } from './objective';

export class EscortObjectiveStub extends Objective<EscortObjective> {
  readonly target = 1;

  step(): void {
    // 2-5 で輸送機の到着を判定する
  }
}

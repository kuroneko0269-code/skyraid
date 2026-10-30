// 怪獣（フェーズ6 で実装）。今は型と空の実装だけで、達成しない
import type { KaijuObjective } from '../types';
import { Objective } from './objective';

export class KaijuObjectiveStub extends Objective<KaijuObjective> {
  /** 進み具合はダメージの割合（%） */
  readonly target = 100;

  step(): void {
    // フェーズ6 で怪獣に与えたダメージの割合を数える
  }
}

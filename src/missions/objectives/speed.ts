// 速度到達（4-11。チュートリアルのスロットルとアフターバーナー）: 目標が始まってから、自機の速度が speed（m/s）に届けば達成。
// 進み具合は今の速度（整数に切り捨て。達成までの最大値を保つ）
import type { SpeedObjective as SpeedObjectiveDef } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';

export class SpeedObjective extends Objective<SpeedObjectiveDef> {
  readonly target: number;

  constructor(def: SpeedObjectiveDef) {
    super(def);
    this.target = def.speed;
  }

  step(world: MissionWorld): void {
    if (!world.playerActive) return;
    this.setProgress(Math.max(this.current, Math.floor(world.playerSpeed + 1e-6)));
  }
}

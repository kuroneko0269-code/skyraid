// 生存時間（2-4）: 目標が始まってから seconds 秒飛び続ける（撃墜されたら「自機撃墜」でミッション失敗）。
// 進み具合は経過秒（整数に切り捨て）
import type { SurviveObjective } from '../types';
import type { MissionWorld } from '../world';
import { Objective } from './objective';

export class SurviveTimeObjective extends Objective<SurviveObjective> {
  readonly target: number;
  /** 目標が始まってからの経過（秒） */
  elapsed = 0;

  constructor(def: SurviveObjective) {
    super(def);
    this.target = def.seconds;
  }

  step(world: MissionWorld, dt: number): void {
    if (!world.playerActive) return;
    this.elapsed += dt;
    // 浮動小数の足し算で 59.99999 秒になるのを防ぐ
    const seconds = Math.floor(this.elapsed + 1e-6);
    this.setProgress(seconds);
  }
}

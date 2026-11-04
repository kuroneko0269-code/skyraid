// 課題（9-5c。チュートリアルの章）: 条件の判定はランナーの外（src/missions/tutorial/coach.ts）が毎ステップ行い、report で進める
import type { TaskObjective as TaskObjectiveDef } from '../types';
import { Objective } from './objective';

export class TaskObjective extends Objective<TaskObjectiveDef> {
  readonly target: number;

  constructor(def: TaskObjectiveDef) {
    super(def);
    this.target = def.count;
  }

  /** ランナーの step では何もしない（判定は外から） */
  step(): void {
    // 何もしない
  }

  /** 進み具合を知らせる（進行中のときだけ。下がらない） */
  report(value: number): void {
    if (this.status !== 'active') return;
    this.setProgress(Math.max(this.current, Math.floor(value + 1e-9)));
  }
}

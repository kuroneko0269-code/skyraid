// 目標の共通の形（2-4、Three.js 非依存）。種類ごとの実装は同じディレクトリに 1 ファイルずつ
import type { ObjectiveDef } from '../types';
import type { MissionWorld } from '../world';

/** pending: まだ始まっていない（順番待ち） / active: 進行中 / complete: 達成 / failed: 失敗 */
export type ObjectiveStatus = 'pending' | 'active' | 'complete' | 'failed';

/** 目標の進み具合を追うもの。ランナーが activate → 毎ステップ step を呼ぶ */
export abstract class Objective<D extends ObjectiveDef = ObjectiveDef> {
  status: ObjectiveStatus = 'pending';
  /** 進み具合（current / target）。HUD の「敵機撃墜 1 / 3」 */
  current = 0;
  abstract readonly target: number;

  constructor(readonly def: D) {}

  /** 目標が始まったとき（順番が来たとき） */
  activate(world: MissionWorld): void {
    this.status = 'active';
    this.onActivate?.(world);
  }

  /** 固定ステップ 1 回分（進行中のときだけ呼ばれる）。達成したら status を complete にする */
  abstract step(world: MissionWorld, dt: number): void;

  /** 始まったときの準備（撃墜数の数えはじめなど）。なければ何もしない */
  protected onActivate?(world: MissionWorld): void;

  /** current を進め、target に届いたら達成 */
  protected setProgress(value: number): void {
    this.current = Math.min(this.target, value);
    if (this.current >= this.target) this.status = 'complete';
  }
}

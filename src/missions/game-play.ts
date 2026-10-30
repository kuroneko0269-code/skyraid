// 1 回の飛行の進め方（2-4、Three.js 非依存）: フリーフライトか、ミッション（ランナー付き）か。
// main は飛行に入るときに startFree / startMission を呼び、固定ステップで step を呼ぶだけ
import type { CombatInput } from '../combat/combat-system';
import type { AircraftControls } from '../entities/aircraft';
import type { BoundaryWatch } from './boundary';
import type { FlightSession } from './flight-session';
import { MissionRunner } from './runner';
import type { MissionDef } from './types';

export class GamePlay {
  /** 進行中（または終わったばかり）のミッション。フリーフライトなら null */
  runner: MissionRunner | null = null;
  private readonly runnerListeners: ((runner: MissionRunner | null) => void)[] = [];

  constructor(readonly session: FlightSession) {}

  /** ランナーが変わったとき（ミッションの開始・フリーフライトの開始）。HUD がイベントを購読し直す */
  onRunnerChange(fn: (runner: MissionRunner | null) => void): void {
    this.runnerListeners.push(fn);
  }

  /** 今の戦域の境界（ミッションはランナー、フリーフライトは警告だけ） */
  get boundary(): BoundaryWatch {
    return this.runner?.boundary ?? this.session.freeBoundary;
  }

  startFree(): void {
    this.session.startFree();
    this.setRunner(null);
  }

  startMission(def: MissionDef): MissionRunner {
    this.session.startMission(def.start);
    const runner = new MissionRunner(def, this.session);
    this.setRunner(runner);
    runner.start();
    return runner;
  }

  /** 固定ステップ 1 回分（世界 → ミッションの順。ランナーはこのステップの結果を読む） */
  step(controls: Readonly<AircraftControls>, input: Readonly<CombatInput>, dt: number): void {
    this.session.step(controls, input, dt);
    this.runner?.step(dt);
  }

  /** ミッションを中断する（ポーズメニュー） */
  abortMission(): void {
    this.runner?.abort();
  }

  private setRunner(runner: MissionRunner | null): void {
    this.runner = runner;
    for (const fn of this.runnerListeners) fn(runner);
  }
}

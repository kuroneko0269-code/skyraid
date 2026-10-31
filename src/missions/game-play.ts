// 1 回の飛行の進め方（2-4、Three.js 非依存）: フリーフライトか、ミッション（ランナー付き）か。
// main は飛行に入るときに startFree / startMission を呼び、固定ステップで step を呼ぶだけ
import { createCombatInput, type CombatInput } from '../combat/combat-system';
import { RACE_CONFIG } from '../data/race';
import type { AircraftControls } from '../entities/aircraft';
import { headingQuat } from '../entities/enemy-aircraft';
import { quatIdentity, vec3 } from '../flight/math';
import type { BoundaryWatch } from './boundary';
import type { FlightSession } from './flight-session';
import { RaceRunner, type RaceReference, type RaceWorld } from './race/runner';
import type { CourseDef } from './race/types';
import { MissionRunner } from './runner';
import type { MissionDef, Pose } from './types';

/** レース中（7-1）は武器を使わない */
const NO_WEAPONS = createCombatInput();

export class GamePlay {
  /** 進行中（または終わったばかり）のミッション。フリーフライトなら null */
  runner: MissionRunner | null = null;
  /** 進行中（または終わったばかり）のリングレース（7-1）。レースでなければ null */
  race: RaceRunner | null = null;
  private readonly runnerListeners: ((runner: MissionRunner | null) => void)[] = [];
  private readonly raceListeners: ((race: RaceRunner | null) => void)[] = [];
  private readonly raceWorld: RaceWorld;
  private readonly placeAt = vec3();
  private readonly placeQuat = quatIdentity();

  constructor(readonly session: FlightSession) {
    const a = session.aircraft;
    this.raceWorld = {
      get playerPosition() {
        return a.state.position;
      },
      get playerPrevPosition() {
        return a.prevPosition;
      },
      get playerOrientation() {
        return a.state.orientation;
      },
      get playerActive() {
        return session.player.active;
      },
    };
    // レースの墜落（練習扱いなので撃墜にならず、その場の上空へ戻る）は、最後に通ったリングへ置き直す。
    // カメラを寄せ直すリスナー（main）より先に登録されるので、カメラは置き直した位置へ寄る
    session.onRespawn(() => {
      if (this.race?.phase === 'racing') this.place(this.race.respawnPose(), false);
    });
  }

  /** レースが変わったとき（7-1。レースの開始・ほかの飛行の開始） */
  onRaceChange(fn: (race: RaceRunner | null) => void): void {
    this.raceListeners.push(fn);
  }

  /** ランナーが変わったとき（ミッションの開始・フリーフライトの開始）。HUD がイベントを購読し直す */
  onRunnerChange(fn: (runner: MissionRunner | null) => void): void {
    this.runnerListeners.push(fn);
  }

  /** 今の戦域の境界（ミッションはランナー、フリーフライトは警告だけ） */
  get boundary(): BoundaryWatch {
    return this.runner?.boundary ?? this.session.freeBoundary;
  }

  startFree(): void {
    this.setRace(null);
    this.session.startFree();
    this.setRunner(null);
  }

  /** PvP（5-1）: 敵・的・ミッションなしで世界を空にする（機体は net/ が動かし、session.step は呼ばない） */
  startEmpty(start: Readonly<Pose>): void {
    this.setRace(null);
    this.session.startMission(start);
    this.setRunner(null);
  }

  startMission(def: MissionDef): MissionRunner {
    this.setRace(null);
    this.session.startMission(def.start, def.practice === true);
    const runner = new MissionRunner(def, this.session);
    this.setRunner(runner);
    runner.start();
    return runner;
  }

  /**
   * リングレース（7-1）を始める: 敵・的なしの世界で、墜落は撃墜にしない（練習と同じ）。
   * reference はベストの走行（ゴーストとの差・スプリットに使う）
   */
  startRace(course: CourseDef, reference: RaceReference | null = null): RaceRunner {
    this.session.startMission(course.start, true);
    this.setRunner(null);
    const race = new RaceRunner(course, reference);
    race.bus.on('race:ring', ({ ring }) => {
      if (ring.kind === 'boost')
        this.session.aircraft.flight.freeAfterburnerSeconds = RACE_CONFIG.boostSeconds;
    });
    this.setRace(race);
    this.place(course.start, true);
    return race;
  }

  /** 固定ステップ 1 回分（世界 → ミッションの順。ランナーはこのステップの結果を読む） */
  step(controls: Readonly<AircraftControls>, input: Readonly<CombatInput>, dt: number): void {
    const race = this.race;
    if (race) {
      // カウントダウン中はスタート地点に止め、スロットル全開で待つ。レース中は武器なし
      if (race.phase === 'countdown') this.place(race.course.start, true);
      else this.session.step(controls, NO_WEAPONS, dt);
      race.step(dt, this.raceWorld);
      return;
    }
    this.session.step(controls, input, dt);
    this.runner?.step(dt);
  }

  /** 自機を pose に水平で置く（巡航速度）。fullThrottle ならスロットル全開 */
  private place(pose: Readonly<Pose>, fullThrottle: boolean): void {
    const a = this.session.aircraft;
    this.placeAt.x = pose.x;
    this.placeAt.y = pose.y;
    this.placeAt.z = pose.z;
    a.respawn(this.placeAt, headingQuat(this.placeQuat, pose.headingDeg));
    if (fullThrottle) a.throttle = 1;
  }

  /** ミッションを中断する（ポーズメニュー） */
  abortMission(): void {
    this.runner?.abort();
    // レース（7-1）は捨てる（記録・報酬なし）
    this.setRace(null);
  }

  private setRace(race: RaceRunner | null): void {
    if (this.race === race) return;
    this.race = race;
    for (const fn of this.raceListeners) fn(race);
  }

  private setRunner(runner: MissionRunner | null): void {
    this.runner = runner;
    for (const fn of this.runnerListeners) fn(runner);
  }
}

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
import { SeededRandom } from '../core/random';
import { DefenseRunner } from './defense/runner';
import { DEFENSE_CONFIG, type DefenseDifficulty, type DefenseMapDef } from '../data/defense';
import type { MissionDef, Pose } from './types';
import { PracticeRunner } from './practice/runner';
import { freeExtraOf } from './free-extra';

/** レース中（7-1）は武器を使わない */
const NO_WEAPONS = createCombatInput();

export class GamePlay {
  /** 進行中（または終わったばかり）のミッション。フリーフライトなら null */
  runner: MissionRunner | null = null;
  /** 進行中（または終わったばかり）のリングレース（7-1）。レースでなければ null */
  race: RaceRunner | null = null;
  /** 進行中（または終わったばかり）の防衛戦（7-2）。防衛戦でなければ null */
  defense: DefenseRunner | null = null;
  /** 防衛戦の乱数（7-B。来る方向・目標の施設。reseed で掛け直す） */
  readonly defenseRandom = new SeededRandom(2);
  private readonly defenseListeners: ((d: DefenseRunner | null) => void)[] = [];
  /** 進行中（または終わったばかり）の練習場（9-5）。練習場でなければ null */
  practice: PracticeRunner | null = null;
  private readonly practiceListeners: ((p: PracticeRunner | null) => void)[] = [];
  private readonly defender = { id: 0, position: vec3(), speed: 0, active: false };
  private readonly runnerListeners: ((runner: MissionRunner | null) => void)[] = [];
  private readonly raceListeners: ((race: RaceRunner | null) => void)[] = [];
  private readonly raceWorld: RaceWorld;
  private readonly placeAt = vec3();
  private readonly placeQuat = quatIdentity();
  /** ミサイルを撃ち尽くしてからの秒数（8-6b。missileResupplySeconds のあるミッションだけ数える） */
  private missileEmpty = 0;

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

  /** 防衛戦が変わったとき（7-2） */
  onDefenseChange(fn: (d: DefenseRunner | null) => void): void {
    this.defenseListeners.push(fn);
  }

  /** 練習場が変わったとき（9-5） */
  onPracticeChange(fn: (p: PracticeRunner | null) => void): void {
    this.practiceListeners.push(fn);
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
    this.setPractice(null);
    this.setRace(null);
    this.setDefense(null);
    this.session.startFree();
    this.setRunner(null);
    freeExtraOf(this)?.start();
  }

  /** PvP（5-1）: 敵・的・ミッションなしで世界を空にする（機体は net/ が動かし、session.step は呼ばない） */
  startEmpty(start: Readonly<Pose>): void {
    freeExtraOf(this)?.stop();
    this.setPractice(null);
    this.setRace(null);
    this.setDefense(null);
    this.session.startMission(start);
    this.setRunner(null);
  }

  startMission(def: MissionDef): MissionRunner {
    freeExtraOf(this)?.stop();
    this.setPractice(null);
    this.setRace(null);
    this.setDefense(null);
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
    freeExtraOf(this)?.stop();
    this.session.startMission(course.start, true);
    this.setPractice(null);
    this.setRunner(null);
    this.setDefense(null);
    const race = new RaceRunner(course, reference);
    race.bus.on('race:ring', ({ ring }) => {
      if (ring.kind === 'boost')
        this.session.aircraft.flight.freeAfterburnerSeconds = RACE_CONFIG.boostSeconds;
    });
    this.setRace(race);
    this.place(course.start, true);
    return race;
  }

  /**
   * 防衛戦（7-2。ソロ）を始める: 基地の近くの開始位置から、敵・的なしの世界で（敵は波ごとにランナーが出す）。
   * 補給の判定は自機。撃墜されたら開始位置へ戻る（ミッションと同じ）
   */
  startDefense(
    map: DefenseMapDef,
    difficulty: DefenseDifficulty,
    seed?: () => number,
  ): DefenseRunner {
    freeExtraOf(this)?.stop();
    this.setPractice(null);
    this.setRace(null);
    this.session.startMission(map.start, false);
    this.setRunner(null);
    const s = this.session;
    const d = new DefenseRunner(
      {
        props: s.props,
        squadron: s.squadron,
        combat: s.combat,
        enemies: s.enemies,
        groundHeight: s.groundAt,
      },
      {
        map,
        difficulty,
        players: 1,
        rng: seed ?? this.defenseRandom.next,
        maxFighters: DEFENSE_CONFIG.soloFighterPool,
      },
    );
    d.bus.on('defense:supply', ({ fraction }) => {
      s.combat.resupplyPart(fraction);
    });
    this.setDefense(d);
    d.start();
    return d;
  }

  /** 練習場（9-5）: 練習扱いの世界で課題の開始位置から。aspect は指標（画面の外）の縦横比（記録のヘッダにも入れる） */
  startPractice(drill: PracticeRunner['drill'], aspect: number): PracticeRunner {
    freeExtraOf(this)?.stop();
    this.setRace(null);
    this.setDefense(null);
    const p = new PracticeRunner(drill, this.session, aspect);
    this.session.startMission(p.start, true);
    this.setRunner(null);
    this.place(p.start, true);
    p.begin();
    this.setPractice(p);
    return p;
  }

  /** 判定の乱数を掛け直す（7-B: 記録する飛行の始め。再生も同じシードで始める） */
  reseed(seed: number): void {
    this.session.random.reseed(seed);
    this.defenseRandom.reseed((seed ^ 0x9e3779b9) >>> 0);
    freeExtraOf(this)?.reseed(seed);
  }

  /** 固定ステップ 1 回分（世界 → ミッションの順。ランナーはこのステップの結果を読む） */
  step(controls: Readonly<AircraftControls>, input: Readonly<CombatInput>, dt: number): void {
    const practice = this.practice;
    if (practice) {
      practice.stepWorld(controls, input, dt, (pose) => {
        this.place(pose, true);
      });
      return;
    }
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
    // 9-6a: フリーフライトの開発中の物（?dev=kaiju2 のときだけ付いている）
    if (this.runner === null && this.defense === null) freeExtraOf(this)?.step(dt);
    this.stepResupply(dt);
    const d = this.defense;
    if (d) {
      const a = this.session.aircraft.state;
      const me = this.defender;
      me.position.x = a.position.x;
      me.position.y = a.position.y;
      me.position.z = a.position.z;
      me.speed = a.speed;
      me.active = this.session.player.active;
      d.step(dt, [me]);
    }
  }

  /**
   * ミサイルの補充（8-6b。8-6d でキャンペーン共通）: 撃ち尽くして missileResupplySeconds たったら満タンに戻し、HUD に知らせる。
   * 撃ち尽くすと機銃だけでは初見の人が敵を倒せなかったため
   */
  private stepResupply(dt: number): void {
    const r = this.runner;
    const after = r?.def.missileResupplySeconds;
    const ammo = this.session.combat.missileAmmo;
    if (!r?.running || after === undefined || !this.session.player.active || ammo.count > 0) {
      this.missileEmpty = 0;
      return;
    }
    this.missileEmpty += dt;
    if (this.missileEmpty < after) return;
    this.missileEmpty = 0;
    ammo.refill();
    r.bus.emit('mission:resupply', { missiles: ammo.count });
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

  /**
   * 起動直後の写しの書き戻し（7-B の pristine.restore）は runner・race・defense を直接書き換えるので、購読者（HUD）には
   * 届かない。書き戻しの後に今の値を知らせ直す（7-C。防衛戦の HUD がレイド・レースに残っていた）
   */
  announceModes(): void {
    for (const fn of this.runnerListeners) fn(this.runner);
    for (const fn of this.raceListeners) fn(this.race);
    for (const fn of this.defenseListeners) fn(this.defense);
    for (const fn of this.practiceListeners) fn(this.practice);
  }

  /** ミッションを中断する（ポーズメニュー） */
  abortMission(): void {
    this.runner?.abort();
    // レース（7-1）・防衛戦（7-2）・練習場（9-5）は捨てる（記録・報酬なし）
    this.setRace(null);
    this.setDefense(null);
    this.setPractice(null);
  }

  private setPractice(p: PracticeRunner | null): void {
    if (this.practice === p) return;
    this.practice = p;
    for (const fn of this.practiceListeners) fn(p);
  }

  private setDefense(d: DefenseRunner | null): void {
    if (this.defense === d) return;
    this.defense = d;
    for (const fn of this.defenseListeners) fn(d);
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

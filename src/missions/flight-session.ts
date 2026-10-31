// 飛行 1 回分のゲーム状態（Three.js 非依存）: プレイヤー機・HP・戦闘（的・ドローン）・敵機（2-3）・
// ミッションの出現物（輸送機・怪獣・地上目標。2-5）。
// フリーフライト（startFree）とミッション（startMission。出現物はランナーが spawn で出す）で共用する（2-4）。
// 固定ステップで step() を呼ぶ。撃墜（地面・海面への墜落も）されると playerRespawnSeconds 後に復帰する:
// フリーフライトは墜落（撃墜）地点の地表から spawn.position.y（300m）上空に水平で、ミッションは開始位置へ（4-6 の事前修正）
import { EnemySquadron, createEnemies } from '../ai/enemy-squadron';
import { CombatSystem, createCombatInput, type CombatInput } from '../combat/combat-system';
import type { Rng } from '../combat/gun';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import { FREE_FLIGHT_ENEMIES, type Difficulty, type EnemyForceConfig } from '../data/ai';
import { FLIGHT_CONFIG } from '../data/flight';
import { ISLAND_MAP } from '../data/maps';
import { WORLD_CONFIG } from '../data/terrain';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import { headingDegOf, headingQuat, type EnemyAircraft } from '../entities/enemy-aircraft';
import { PlayerVitals } from '../entities/player-vitals';
import { TargetField } from '../entities/target-balloon';
import type { FlightOptions } from '../flight/flight-model';
import type { Loadout } from '../progression/loadout';
import { copyQuat, copyVec3, quatIdentity, vec3, type Quat, type Vec3 } from '../flight/math';
import { BoundaryWatch } from './boundary';
import { protectedPercent, type BuildingField } from '../combat/buildings';
import { DestroyTally } from './destroy-tally';
import { configureDrones, spawnInSession } from './session-spawn';
import { KaijuExposure } from './kaiju-exposure';
import { MissionProps, type EscortState } from './mission-props';
import type { DestroyableKind, Pose, SpawnDef } from './types';
import type { MissionWorld } from './world';

export interface FlightSessionOptions {
  groundHeight?: GroundHeightFn;
  rng?: Rng;
  flightOptions?: Partial<FlightOptions>;
  /** フリーフライトの初期位置（リスポーンもここ）。機首は -Z */
  start?: Readonly<Vec3>;
  /** 敵の出し方（テストのシミュレーションで島から離れた場所に出す） */
  enemies?: EnemyForceConfig;
  /** 今のマップの街の建物（6-4。なければ null）。自機の衝突・開始時の建て直し・「守れた建物」 */
  buildings?: () => BuildingField | null;
}

export type SessionMode = 'free' | 'mission';

const NO_INPUT = createCombatInput();
/** スタン中の操作（6-2。すべて離した状態） */
const STUNNED: AircraftControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };

export class FlightSession implements MissionWorld {
  readonly aircraft: Aircraft;
  readonly player: PlayerVitals;
  readonly combat: CombatSystem;
  readonly squadron: EnemySquadron;
  readonly enemies: readonly EnemyAircraft[];
  /** 輸送機・怪獣・地上目標（ミッションの出現物。2-5） */
  readonly props: MissionProps;
  /** 怪獣の咆哮のスタンとフレアの時間（6-2） */
  readonly kaijuExposure: KaijuExposure;
  /** 地表の高さ（地形なしのテストでは FLIGHT_CONFIG.groundAltitude） */
  private readonly ground: (x: number, z: number) => number;
  private readonly buildings: () => BuildingField | null;
  /** PvP の他プレイヤー（5-3。レーダーの点・命中音に使う。シングルプレイでは空） */
  readonly rivals: CombatTarget[] = [];
  /** フリーフライトの戦域の境界（警告だけ。ミッションの境界はランナーが持つ） */
  readonly freeBoundary = new BoundaryWatch(ISLAND_MAP, false);
  mode: SessionMode = 'free';
  private freeStart: Readonly<Vec3>;
  /** 今の開始位置・向き（リスポーンもここ） */
  private readonly startPosition: Vec3 = vec3();
  private readonly startOrientation: Quat = quatIdentity();
  /** 撃墜・破壊の数。startFree / startMission で 0 に戻す */
  private readonly destroyed: DestroyTally;
  /** 撃墜を知らせた回数（player.downCount と比べる） */
  private notifiedDowns = 0;
  private readonly wreck: Vec3 = vec3();
  private readonly wreckOrientation: Quat = quatIdentity();
  private readonly downListeners: (() => void)[] = [];
  private readonly respawnListeners: (() => void)[] = [];
  /** ミッション中に変えたフリーフライトの敵の設定（次のフリーフライトで使う） */
  private pendingEnemies: { enabled: boolean; difficulty: Difficulty; count?: number } | null =
    null;

  constructor(options: FlightSessionOptions = {}) {
    const ground = options.groundHeight;
    this.ground = ground ?? (() => FLIGHT_CONFIG.groundAltitude);
    this.buildings = options.buildings ?? (() => null);
    const rng = options.rng ?? Math.random;
    this.freeStart = options.start ?? WORLD_CONFIG.start;
    copyVec3(this.startPosition, this.freeStart);
    this.aircraft = new Aircraft(undefined, options.flightOptions ?? {}, undefined, ground);
    this.player = new PlayerVitals(this.aircraft);
    const force = options.enemies ?? FREE_FLIGHT_ENEMIES;
    const enemies = createEnemies(ground, force);
    this.enemies = enemies;
    this.props = new MissionProps(ground, rng);
    this.destroyed = new DestroyTally(enemies, this.props);
    this.combat = new CombatSystem(
      new TargetField(ground, rng),
      ground ?? null,
      rng,
      undefined,
      undefined,
      undefined,
      enemies,
      this.player,
      this.props.hostileTargets,
      this.props.transports,
    );
    this.squadron = new EnemySquadron(this.combat, enemies, ground, rng, force);
    this.combat.onDestroyed(this.destroyed.count);
    this.kaijuExposure = new KaijuExposure(this.player, this.combat.flares);
    this.props.onKaijuHit = {
      damage: (_id, amount) => {
        this.combat.dealDamage(this.player, amount, TEAM_ENEMY);
      },
      stun: (_id, seconds) => {
        this.kaijuExposure.applyStun(seconds);
      },
    };
    this.props.onAaaHit = (h) => {
      this.combat.reportImpact(h.x, h.y, h.z, true);
      this.combat.dealDamage(this.player, this.props.aaa.config.damage, TEAM_ENEMY);
    };
  }

  /** プレイヤーが撃墜されたとき（演出用） */
  onPlayerDown(fn: () => void): void {
    this.downListeners.push(fn);
  }

  /** リスポーンしたとき（カメラを寄せ直す） */
  onRespawn(fn: () => void): void {
    this.respawnListeners.push(fn);
  }

  /** フリーフライトの敵の有無・難易度を変える（フリーフライト中なら出し直す。ミッション中は次のフリーフライトから） */
  configureEnemies(enabled: boolean, difficulty: Difficulty, count?: number): void {
    if (this.mode === 'free') this.squadron.configure(enabled, difficulty, count);
    else this.pendingEnemies = { enabled, difficulty, count };
  }

  /**
   * 機体と強化の装備に差し替える（3-3）: 飛行モデル・HP・武装。startFree / startMission の前に呼ぶ
   * （開始で巡航速度・HP 満タン・弾満タンになる）
   */
  applyLoadout(l: Readonly<Loadout>): void {
    this.aircraft.setSpec(l.flight);
    this.player.setMaxHp(l.flight.hull.maxHp);
    this.combat.applyLoadout(l);
  }

  /** フリーフライトの開始位置（6-4: マップごと。機首は -Z） */
  setFreeStart(start: Readonly<Vec3>): void {
    this.freeStart = start;
  }

  /** フリーフライトを初めから（startFree と同じ） */
  reset(): void {
    this.startFree();
  }

  /** フリーフライトを始める。起動位置・巡航速度・HP 満タン・弾満タン・的とドローン全部・敵の出し直し */
  startFree(): void {
    this.mode = 'free';
    this.player.immortal = false;
    copyVec3(this.startPosition, this.freeStart);
    this.startOrientation.x = this.startOrientation.y = this.startOrientation.z = 0;
    this.startOrientation.w = 1;
    this.begin();
    this.combat.targets.configure(this.combat.targets.balloons.length, true);
    configureDrones(this.combat.drones, this.combat.drones.length, true);
    this.squadron.respawns = true;
    const pending = this.pendingEnemies;
    this.pendingEnemies = null;
    if (pending) this.squadron.configure(pending.enabled, pending.difficulty, pending.count);
    else this.squadron.reset();
  }

  /**
   * ミッションを始める。start の位置・向きから、的・ドローン・敵機なし（出現物はランナーが spawn で出す）。
   * practice（4-11。チュートリアル）なら撃墜されず、墜落は上空へ戻す
   */
  startMission(start: Readonly<Pose>, practice = false): void {
    this.mode = 'mission';
    this.player.immortal = practice;
    this.startPosition.x = start.x;
    this.startPosition.y = start.y;
    this.startPosition.z = start.z;
    headingQuat(this.startOrientation, start.headingDeg);
    this.begin();
    this.combat.targets.configure(0, false);
    configureDrones(this.combat.drones, 0, false);
    this.squadron.respawns = false;
    this.squadron.withdrawAll();
    this.destroyed.clearGroups();
  }

  private begin(): void {
    this.aircraft.respawn(this.startPosition, this.startOrientation);
    this.player.revive();
    this.player.step(1 / 60);
    this.combat.reset();
    this.props.reset();
    this.freeBoundary.reset();
    this.destroyed.clear();
    this.kaijuExposure.reset();
    this.buildings()?.reset();
  }

  /** 固定ステップ 1 回分。撃墜されている間は操作を受け付けない */
  step(controls: Readonly<AircraftControls>, input: Readonly<CombatInput>, dt: number): void {
    const alive = this.player.active;
    // 咆哮のスタン中（6-2）は操作できない
    const stunned = this.kaijuExposure.stunned;
    if (alive) this.stepAircraft(stunned ? STUNNED : controls, dt);
    if (this.player.step(dt)) this.respawn();
    this.squadron.step(dt);
    this.kaijuExposure.step(dt);
    this.props.step(dt, this.player, this.kaijuExposure.targets);
    const armed = this.player.active && !stunned;
    this.combat.step(armed ? input : NO_INPUT, this.aircraft.state, dt);
    if (this.mode === 'free' && this.player.active) {
      const p = this.aircraft.state.position;
      this.freeBoundary.step(p.x, p.z, dt);
    }
    // 敵の機銃（squadron）・ミサイル（combat）・墜落のどれで落ちても、このステップで知らせる
    if (this.player.downCount !== this.notifiedDowns) {
      this.notifiedDowns = this.player.downCount;
      for (const fn of this.downListeners) fn();
    }
  }

  /** 自機を動かす。地面・海面に墜落したら撃墜と同じ扱い（2-4。HP 0、残骸は墜落の直前の位置） */
  private stepAircraft(controls: Readonly<AircraftControls>, dt: number): void {
    const a = this.aircraft;
    const crashes = a.crashCount;
    copyVec3(this.wreck, a.state.position);
    copyQuat(this.wreckOrientation, a.state.orientation);
    a.step(controls, dt);
    // 6-4: 高層の建物に当たっても墜落（低層は飛び抜けられる）
    const hitBuilding = this.buildings()?.collides(this.wreck, a.state.position) ?? false;
    if (a.crashCount === crashes && !hitBuilding) return;
    // Aircraft は墜落すると上空へ戻すので、残骸の位置に置き直す（撃墜中は動かさない）
    a.respawn(this.wreck, this.wreckOrientation);
    // 練習（4-11）: 墜落にせず、その場の地表から 300m 上空へ戻す（HP・弾はそのまま）
    if (this.player.immortal) {
      this.respawnAboveWreck();
      for (const fn of this.respawnListeners) fn();
      return;
    }
    this.player.crash();
    this.combat.notifyDestroyed(this.player);
  }

  /** プレイヤーを追っている敵のミサイルの数（HUD の MISSILE 警告） */
  get incomingMissiles(): number {
    return this.player.active ? this.combat.incomingMissiles(this.player) : 0;
  }

  // ---- MissionWorld（ミッションランナーが読む） ----

  get playerPosition(): Readonly<Vec3> {
    return this.aircraft.state.position;
  }

  get playerPrevPosition(): Readonly<Vec3> {
    return this.aircraft.prevPosition;
  }

  get playerSpeed(): number {
    return this.aircraft.state.speed;
  }

  get playerActive(): boolean {
    return this.player.active;
  }

  get playerDowns(): number {
    return this.player.downCount;
  }

  get playerDamageTaken(): number {
    return this.player.damageTaken;
  }

  get playerMaxHp(): number {
    return this.player.maxHp;
  }

  get escortLost(): boolean {
    return this.props.escortLost;
  }

  escort(group: string): EscortState | null {
    return this.props.escort(group);
  }

  get kaijuDamageRatio(): number {
    return this.props.kaijuDamageRatio;
  }

  get kaijuReachedCity(): boolean {
    return this.props.kaijuReachedCity;
  }

  get protectedBuildings(): number | null {
    const b = this.buildings();
    return b ? protectedPercent(b) : null;
  }

  spawn(def: SpawnDef): void {
    spawnInSession(def, {
      squadron: this.squadron,
      combat: this.combat,
      props: this.props,
      destroyed: this.destroyed,
    });
  }

  destroyedCount(kind: DestroyableKind, group?: string): number {
    return this.destroyed.get(kind, group);
  }

  private respawn(): void {
    if (this.mode === 'free') this.respawnAboveWreck();
    else this.aircraft.respawn(this.startPosition, this.startOrientation);
    this.player.revive();
    this.player.step(1 / 60);
    this.combat.resupply();
    for (const fn of this.respawnListeners) fn();
  }

  /**
   * 指定の位置・向きへ戻す（PvP。5-3 の事前修正: どこへ戻すかはホストが決める）。HP 満タン・補給して、
   * シングルと同じリスナー（機体とカメラを新しい位置へすぐ移す）を呼ぶ
   */
  respawnAt(position: Readonly<Vec3>, orientation: Readonly<Quat>): void {
    this.aircraft.respawn(position, orientation);
    this.revived();
  }

  /** 機体はもう置いてある（PvP の通信側が復帰の位置から計算し直した。5-3）: HP 満タン・補給・リスナー */
  revived(): void {
    this.player.revive();
    this.player.step(1 / 60);
    this.combat.resupply();
    for (const fn of this.respawnListeners) fn();
  }

  /** 撃墜された（PvP。5-3。判定はホスト）: HP 0、撃墜の演出とリスナー */
  markDown(): void {
    if (!this.player.active) return;
    this.player.crash();
    this.combat.notifyDestroyed(this.player);
    this.notifiedDowns = this.player.downCount;
    for (const fn of this.downListeners) fn();
  }

  /** フリーフライト: 墜落（撃墜）地点の地表から spawn.position.y 上空に、墜落前の機首方位のまま水平で戻す */
  private respawnAboveWreck(): void {
    const a = this.aircraft;
    const p = a.state.position;
    this.wreck.x = p.x;
    this.wreck.y = this.ground(p.x, p.z) + FLIGHT_CONFIG.spawn.position.y;
    this.wreck.z = p.z;
    a.respawn(this.wreck, headingQuat(this.wreckOrientation, headingDegOf(a.state.orientation)));
  }
}

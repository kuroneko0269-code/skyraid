// 飛行 1 回分のゲーム状態（Three.js 非依存）: プレイヤー機・HP・戦闘（的・ドローン）・敵機（2-3）。
// フリーフライト（startFree）とミッション（startMission。出現物はランナーが spawn で出す）で共用する（2-4）。
// 固定ステップで step() を呼ぶ。撃墜（地面・海面への墜落も）されると playerRespawnSeconds 後に開始位置へ戻る
import { EnemySquadron, createEnemies } from '../ai/enemy-squadron';
import { CombatSystem, createCombatInput, type CombatInput } from '../combat/combat-system';
import type { Rng } from '../combat/gun';
import type { CombatTarget } from '../combat/target';
import { FREE_FLIGHT_ENEMIES, type Difficulty, type EnemyForceConfig } from '../data/ai';
import { ISLAND_MAP } from '../data/maps';
import { WORLD_CONFIG } from '../data/terrain';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import { EnemyAircraft, headingQuat } from '../entities/enemy-aircraft';
import { PlayerVitals } from '../entities/player-vitals';
import { TargetBalloon, TargetField } from '../entities/target-balloon';
import { TargetDrone } from '../entities/target-drone';
import type { FlightOptions } from '../flight/flight-model';
import { copyQuat, copyVec3, quatIdentity, vec3, type Quat, type Vec3 } from '../flight/math';
import { BoundaryWatch } from './boundary';
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
}

export type SessionMode = 'free' | 'mission';

const NO_INPUT = createCombatInput();

export class FlightSession implements MissionWorld {
  readonly aircraft: Aircraft;
  readonly player: PlayerVitals;
  readonly combat: CombatSystem;
  readonly squadron: EnemySquadron;
  readonly enemies: readonly EnemyAircraft[];
  /** フリーフライトの戦域の境界（警告だけ。ミッションの境界はランナーが持つ） */
  readonly freeBoundary = new BoundaryWatch(ISLAND_MAP, false);
  mode: SessionMode = 'free';
  private readonly freeStart: Readonly<Vec3>;
  /** 今の開始位置・向き（リスポーンもここ） */
  private readonly startPosition: Vec3 = vec3();
  private readonly startOrientation: Quat = quatIdentity();
  /** ミッションの敵機の出現物（enemies[i] がどのグループか） */
  private readonly enemyGroups: (string | null)[];
  /** 撃墜・破壊の数（種類ごと・「種類:グループ」ごと）。startFree / startMission で 0 に戻す */
  private readonly destroyed = new Map<string, number>();
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
    const rng = options.rng ?? Math.random;
    this.freeStart = options.start ?? WORLD_CONFIG.start;
    copyVec3(this.startPosition, this.freeStart);
    this.aircraft = new Aircraft(undefined, options.flightOptions ?? {}, undefined, ground);
    this.player = new PlayerVitals(this.aircraft);
    const force = options.enemies ?? FREE_FLIGHT_ENEMIES;
    const enemies = createEnemies(ground, force);
    this.enemies = enemies;
    this.enemyGroups = enemies.map(() => null);
    this.combat = new CombatSystem(
      new TargetField(ground, rng),
      ground ?? null,
      rng,
      undefined,
      undefined,
      undefined,
      enemies,
      this.player,
    );
    this.squadron = new EnemySquadron(this.combat, enemies, ground, rng, force);
    this.combat.onDestroyed(this.countDestroyed);
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

  /** フリーフライトを初めから（startFree と同じ） */
  reset(): void {
    this.startFree();
  }

  /** フリーフライトを始める。起動位置・巡航速度・HP 満タン・弾満タン・的とドローン全部・敵の出し直し */
  startFree(): void {
    this.mode = 'free';
    copyVec3(this.startPosition, this.freeStart);
    this.startOrientation.x = this.startOrientation.y = this.startOrientation.z = 0;
    this.startOrientation.w = 1;
    this.begin();
    this.combat.targets.configure(this.combat.targets.balloons.length, true);
    this.configureDrones(this.combat.drones.length, true);
    this.squadron.respawns = true;
    const pending = this.pendingEnemies;
    this.pendingEnemies = null;
    if (pending) this.squadron.configure(pending.enabled, pending.difficulty, pending.count);
    else this.squadron.reset();
  }

  /** ミッションを始める。start の位置・向きから、的・ドローン・敵機なし（出現物はランナーが spawn で出す） */
  startMission(start: Readonly<Pose>): void {
    this.mode = 'mission';
    this.startPosition.x = start.x;
    this.startPosition.y = start.y;
    this.startPosition.z = start.z;
    headingQuat(this.startOrientation, start.headingDeg);
    this.begin();
    this.combat.targets.configure(0, false);
    this.configureDrones(0, false);
    this.squadron.respawns = false;
    this.squadron.withdrawAll();
    this.enemyGroups.fill(null);
  }

  private begin(): void {
    this.aircraft.respawn(this.startPosition, this.startOrientation);
    this.player.revive();
    this.player.step(1 / 60);
    this.combat.reset();
    this.freeBoundary.reset();
    this.destroyed.clear();
  }

  /** 固定ステップ 1 回分。撃墜されている間は操作を受け付けない */
  step(controls: Readonly<AircraftControls>, input: Readonly<CombatInput>, dt: number): void {
    const alive = this.player.active;
    if (alive) this.stepAircraft(controls, dt);
    if (this.player.step(dt)) this.respawn();
    this.squadron.step(dt);
    this.combat.step(this.player.active ? input : NO_INPUT, this.aircraft.state, dt);
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
    if (a.crashCount === crashes) return;
    // Aircraft は墜落すると上空へ戻すので、残骸の位置に置き直す（撃墜中は動かさない）
    a.respawn(this.wreck, this.wreckOrientation);
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

  /** 護衛（2-5）はまだないので失わない */
  get escortLost(): boolean {
    return false;
  }

  spawn(def: SpawnDef): void {
    switch (def.kind) {
      case 'enemyFighter':
        for (let i = 0; i < def.count; i++) {
          const at = def.positions[i % def.positions.length];
          if (!at) break;
          const index = this.squadron.deploy(at, def.patrol, def.difficulty);
          if (index >= 0) this.enemyGroups[index] = def.group;
        }
        break;
      case 'targets':
        this.combat.targets.configure(def.count, false);
        break;
      case 'drones':
        this.configureDrones(def.count, false);
        break;
      case 'groundTarget':
        // 地上目標は 2-6 で追加する
        break;
    }
  }

  destroyedCount(kind: DestroyableKind, group?: string): number {
    const key = group === undefined ? kind : `${kind}:${group}`;
    return this.destroyed.get(key) ?? 0;
  }

  private configureDrones(count: number, respawns: boolean): void {
    this.combat.drones.forEach((d, i) => {
      d.reset();
      d.deployed = i < count;
      d.respawns = respawns;
    });
  }

  private readonly countDestroyed = (target: CombatTarget): void => {
    let kind: DestroyableKind;
    let group: string | null = null;
    if (target instanceof EnemyAircraft) {
      kind = 'enemyFighter';
      group = this.enemyGroups[this.enemies.indexOf(target)] ?? null;
    } else if (target instanceof TargetBalloon) kind = 'target';
    else if (target instanceof TargetDrone) kind = 'drone';
    else return;
    const keys = group === null ? [kind, 'any'] : [kind, 'any', `${kind}:${group}`, `any:${group}`];
    for (const key of keys) this.destroyed.set(key, (this.destroyed.get(key) ?? 0) + 1);
  };

  private respawn(): void {
    this.aircraft.respawn(this.startPosition, this.startOrientation);
    this.player.revive();
    this.player.step(1 / 60);
    // 補給（弾・フレアも満タンに戻す）
    this.combat.missileAmmo.refill();
    this.combat.flares.magazine.refill();
    this.combat.gun.heat.reset();
    this.combat.targeting.reset();
    for (const fn of this.respawnListeners) fn();
  }
}

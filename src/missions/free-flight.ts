// フリーフライトの 1 回分のゲーム状態（Three.js 非依存）: プレイヤー機・HP・戦闘（的・ドローン）・敵機（2-3）。
// 固定ステップで step() を呼ぶ。撃墜されると playerRespawnSeconds 後に初期位置へ戻る（回数は無限）
import { EnemySquadron, createEnemies } from '../ai/enemy-squadron';
import { CombatSystem, createCombatInput, type CombatInput } from '../combat/combat-system';
import type { Rng } from '../combat/gun';
import { FREE_FLIGHT_ENEMIES, type Difficulty, type EnemyForceConfig } from '../data/ai';
import { WORLD_CONFIG } from '../data/terrain';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import type { EnemyAircraft } from '../entities/enemy-aircraft';
import { PlayerVitals } from '../entities/player-vitals';
import { TargetField } from '../entities/target-balloon';
import type { FlightOptions } from '../flight/flight-model';
import type { Vec3 } from '../flight/math';

export interface FreeFlightOptions {
  groundHeight?: GroundHeightFn;
  rng?: Rng;
  flightOptions?: Partial<FlightOptions>;
  /** 初期位置（リスポーンもここ）。機首は -Z */
  start?: Readonly<Vec3>;
  /** 敵の出し方（テストのシミュレーションで島から離れた場所に出す） */
  enemies?: EnemyForceConfig;
}

const NO_INPUT = createCombatInput();

export class FreeFlight {
  readonly aircraft: Aircraft;
  readonly player: PlayerVitals;
  readonly combat: CombatSystem;
  readonly squadron: EnemySquadron;
  readonly enemies: readonly EnemyAircraft[];
  private readonly start: Readonly<Vec3>;
  /** 撃墜を知らせた回数（player.downCount と比べる） */
  private notifiedDowns = 0;
  private readonly downListeners: (() => void)[] = [];
  private readonly respawnListeners: (() => void)[] = [];

  constructor(options: FreeFlightOptions = {}) {
    const ground = options.groundHeight;
    const rng = options.rng ?? Math.random;
    this.start = options.start ?? WORLD_CONFIG.start;
    this.aircraft = new Aircraft(undefined, options.flightOptions ?? {}, undefined, ground);
    this.player = new PlayerVitals(this.aircraft);
    const force = options.enemies ?? FREE_FLIGHT_ENEMIES;
    const enemies = createEnemies(ground, force);
    this.enemies = enemies;
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
  }

  /** プレイヤーが撃墜されたとき（演出用） */
  onPlayerDown(fn: () => void): void {
    this.downListeners.push(fn);
  }

  /** リスポーンしたとき（カメラを寄せ直す） */
  onRespawn(fn: () => void): void {
    this.respawnListeners.push(fn);
  }

  /** 敵の有無・難易度を変える（敵は出し直す） */
  configureEnemies(enabled: boolean, difficulty: Difficulty, count?: number): void {
    this.squadron.configure(enabled, difficulty, count);
  }

  /** 初めから（モード選択から入るたび）。初期位置・巡航速度・HP 満タン・弾満タン・敵の出し直し */
  reset(): void {
    this.aircraft.respawn(this.start);
    this.player.revive();
    this.player.step(1 / 60);
    this.combat.reset();
    this.squadron.reset();
  }

  /** 固定ステップ 1 回分。撃墜されている間は操作を受け付けない */
  step(controls: Readonly<AircraftControls>, input: Readonly<CombatInput>, dt: number): void {
    const alive = this.player.active;
    if (alive) this.aircraft.step(controls, dt);
    if (this.player.step(dt)) this.respawn();
    this.squadron.step(dt);
    this.combat.step(alive ? input : NO_INPUT, this.aircraft.state, dt);
    // 敵の機銃（squadron）・ミサイル（combat）のどちらで落ちても、このステップで知らせる
    if (this.player.downCount !== this.notifiedDowns) {
      this.notifiedDowns = this.player.downCount;
      for (const fn of this.downListeners) fn();
    }
  }

  /** プレイヤーを追っている敵のミサイルの数（HUD の MISSILE 警告） */
  get incomingMissiles(): number {
    return this.player.active ? this.combat.incomingMissiles(this.player) : 0;
  }

  private respawn(): void {
    this.aircraft.respawn(this.start);
    this.player.revive();
    this.player.step(1 / 60);
    // 補給（フリーフライトなので弾・フレアも満タンに戻す）
    this.combat.missileAmmo.refill();
    this.combat.flares.magazine.refill();
    this.combat.gun.heat.reset();
    this.combat.targeting.reset();
    for (const fn of this.respawnListeners) fn();
  }
}

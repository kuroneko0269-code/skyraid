// 敵機（2-3）。飛行はプレイヤーと同じ Aircraft（src/flight/ の飛行モデル）で、操作は AI が入力値として渡す。
// ロック・機銃・ミサイルの対象（CombatTarget）になる
import { Health } from '../combat/damage';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import type { EnemySpawn } from '../data/ai';
import { AIRCRAFT_COMBAT, ENEMY_FIGHTER, type AircraftSpec } from '../data/aircraft';
import { copyVec3, rotateVec3, vec3, type Quat, type Vec3 } from '../flight/math';
import { Aircraft, type AircraftControls, type GroundHeightFn } from './aircraft';

/** 機首の向き（-Z から右回り、度）のクォータニオン */
export function headingQuat(out: Quat, headingDeg: number): Quat {
  const half = (-headingDeg * Math.PI) / 360;
  out.x = 0;
  out.y = Math.sin(half);
  out.z = 0;
  out.w = Math.cos(half);
  return out;
}

const FORWARD: Readonly<Vec3> = { x: 0, y: 0, z: -1 };
const scratchForward: Vec3 = vec3();

/** 姿勢 q の機首（-Z）の水平の方位（-Z から右回り、度）。真上・真下を向いていたら 0（北向き） */
export function headingDegOf(q: Readonly<Quat>): number {
  const f = rotateVec3(scratchForward, q, FORWARD);
  return Math.abs(f.x) + Math.abs(f.z) < 1e-6 ? 0 : (Math.atan2(f.x, -f.z) * 180) / Math.PI;
}

export class EnemyAircraft implements CombatTarget {
  readonly aircraft: Aircraft;
  readonly velocity: Vec3 = vec3();
  readonly team = TEAM_ENEMY;
  readonly hitRadius: number;
  readonly visualRadius: number;
  /** 出撃中か（false = 撃墜されて再出現待ち、または敵なしの設定） */
  deployed = false;
  /** 再出現までの残り時間（秒） */
  respawnTimer = 0;
  /** 被弾で白く光る残り時間（秒） */
  flashTimer = 0;
  /** 前回 takeDamage() してから受けたダメージ（AI の「被弾が続く」判定に使う） */
  private damageSinceRead = 0;
  private readonly health: Health;
  private readonly spawnQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private readonly wreck: Vec3 = vec3();

  constructor(
    readonly spec: AircraftSpec = ENEMY_FIGHTER,
    groundHeight?: GroundHeightFn,
    /** 撃墜（地面への衝突も）から再出現までの時間（秒）。再出現させるのは呼び出し側 */
    private readonly respawnSeconds = 12,
  ) {
    // AI がロールを操るのでオートレベルは使わない
    this.aircraft = new Aircraft(
      spec,
      { autoLevel: false, invertPitch: false },
      undefined,
      groundHeight,
    );
    this.health = new Health(spec.hull.maxHp);
    this.hitRadius = spec.hull.hitRadius;
    this.visualRadius = spec.hull.visualRadius;
  }

  get position(): Readonly<Vec3> {
    return this.aircraft.state.position;
  }

  get prevPosition(): Readonly<Vec3> {
    return this.aircraft.prevPosition;
  }

  get hp(): number {
    return this.health.hp;
  }

  get maxHp(): number {
    return this.health.maxHp;
  }

  get isDestroyed(): boolean {
    return this.health.isDestroyed;
  }

  get active(): boolean {
    return this.deployed && !this.health.isDestroyed;
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = AIRCRAFT_COMBAT.enemyHitFlashSeconds;
    this.damageSinceRead += amount;
    const destroyed = this.health.applyDamage(amount);
    if (destroyed) this.respawnTimer = this.respawnSeconds;
    return destroyed;
  }

  /** 前回呼んでから受けたダメージを返して 0 に戻す */
  takeDamage(): number {
    const d = this.damageSinceRead;
    this.damageSinceRead = 0;
    return d;
  }

  /** 出現地点に HP 満タン・巡航速度で出す */
  spawn(at: EnemySpawn): void {
    const p = this.wreck;
    p.x = at.x;
    p.y = at.y;
    p.z = at.z;
    this.aircraft.respawn(p, headingQuat(this.spawnQuat, at.headingDeg));
    this.health.reset();
    this.deployed = true;
    this.respawnTimer = 0;
    this.flashTimer = 0;
    this.damageSinceRead = 0;
    this.aircraft.velocity(this.velocity);
  }

  /** 引っ込める（敵なしの設定） */
  withdraw(): void {
    this.deployed = false;
    this.respawnTimer = 0;
  }

  /**
   * 固定ステップ 1 回分。出撃中でなければ何もしない。
   * 地面に衝突したら true（撃墜扱い。位置は衝突直前に戻す）
   */
  step(controls: Readonly<AircraftControls>, dt: number): boolean {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (!this.active) return false;
    const crashes = this.aircraft.crashCount;
    copyVec3(this.wreck, this.aircraft.state.position);
    this.aircraft.step(controls, dt);
    if (this.aircraft.crashCount !== crashes) {
      // Aircraft は上空へ戻すので、残骸の位置（衝突直前）に置き直して撃墜扱いにする
      this.aircraft.respawn(this.wreck, this.aircraft.prevOrientation);
      this.health.applyDamage(this.health.hp);
      this.respawnTimer = this.respawnSeconds;
      return true;
    }
    this.aircraft.velocity(this.velocity);
    return false;
  }
}

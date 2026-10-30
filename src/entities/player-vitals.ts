// プレイヤー機の HP と被弾（2-3）。敵の機銃・ミサイルの対象（CombatTarget）になり、
// HP 0 で撃墜 → playerRespawnSeconds 後にリスポーンの合図を出す（どこへ戻すかは呼び出し側）
import { Health } from '../combat/damage';
import { TEAM_PLAYER, type CombatTarget } from '../combat/target';
import { AIRCRAFT_COMBAT } from '../data/aircraft';
import { vec3, type Vec3 } from '../flight/math';
import type { Aircraft } from './aircraft';

export class PlayerVitals implements CombatTarget {
  readonly velocity: Vec3 = vec3();
  readonly team = TEAM_PLAYER;
  readonly hitRadius: number;
  readonly visualRadius: number;
  /** 被弾で画面を赤く光らせる残り時間（秒） */
  flashTimer = 0;
  /** 撃墜されてからリスポーンまでの残り時間（秒）。生きている間は 0 */
  respawnTimer = 0;
  /** 撃墜された回数（地面への墜落も） */
  downCount = 0;
  /** 受けたダメージの合計（ミッションの評価。2-4）。墜落は含めない */
  damageTaken = 0;
  /** 練習（4-11。チュートリアル）: HP は 1 で止まり、撃墜されない（被弾の赤い光とダメージの記録はする） */
  immortal = false;
  private health: Health;

  constructor(
    readonly aircraft: Aircraft,
    private readonly respawnSeconds: number = AIRCRAFT_COMBAT.playerRespawnSeconds,
    private readonly flashSeconds: number = AIRCRAFT_COMBAT.playerHitFlashSeconds,
  ) {
    const hull = aircraft.flight.spec.hull;
    this.health = new Health(hull.maxHp);
    this.hitRadius = hull.hitRadius;
    this.visualRadius = hull.visualRadius;
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
    return !this.health.isDestroyed;
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = this.flashSeconds;
    const dealt = this.immortal ? Math.min(amount, this.health.hp - 1) : amount;
    if (!(dealt > 0)) return false;
    this.damageTaken += Math.min(dealt, this.health.hp);
    const destroyed = this.health.applyDamage(dealt);
    if (destroyed) this.goDown();
    return destroyed;
  }

  /** 地面・海面への墜落（2-4）。撃墜と同じ扱い（HP 0・respawnSeconds 後にリスポーン） */
  crash(): void {
    if (!this.active) return;
    this.health.applyDamage(this.health.hp);
    this.goDown();
  }

  private goDown(): void {
    this.downCount++;
    this.respawnTimer = this.respawnSeconds;
  }

  /** 機体を動かしたあとに呼ぶ。速度を更新し、タイマーを進める。リスポーンの時なら true */
  step(dt: number): boolean {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (!this.isDestroyed) {
      this.aircraft.velocity(this.velocity);
      return false;
    }
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.respawnTimer -= dt;
    return this.respawnTimer <= 1e-9;
  }

  /** 最大 HP を差し替えて満タンにする（3-3。機体・強化を変えたとき。飛行を始める前に呼ぶ） */
  setMaxHp(maxHp: number): void {
    if (maxHp !== this.health.maxHp) this.health = new Health(maxHp);
    this.health.reset();
  }

  /** HP 満タンで生き返る（位置は呼び出し側で Aircraft.respawn） */
  revive(): void {
    this.health.reset();
    this.respawnTimer = 0;
    this.flashTimer = 0;
  }
}

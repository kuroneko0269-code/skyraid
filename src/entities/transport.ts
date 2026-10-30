// 輸送機（2-5、M3 の護衛対象）。直線経路を一定速度で飛ぶだけで、回避も攻撃もしない。
// CombatTarget を実装し、陣営はプレイヤー側（敵機の機銃・ミサイルの対象になる。プレイヤーの弾は当たらない）
import { Health } from '../combat/damage';
import { TEAM_PLAYER, type CombatTarget } from '../combat/target';
import { TRANSPORT_CONFIG } from '../data/mission-props';
import { copyVec3, vec3, type Vec3 } from '../flight/math';

export type TransportConfig = typeof TRANSPORT_CONFIG;

export class Transport implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  readonly team = TEAM_PLAYER;
  readonly hitRadius: number;
  readonly visualRadius: number;
  /** 出ているか（撃墜されても残骸の扱いで true のまま。active は false） */
  deployed = false;
  /** 出現物のグループ（護衛の目標が参照する） */
  group = '';
  /** 経路の始点からの移動距離と、経路の長さ */
  traveled = 0;
  length = 0;
  flashTimer = 0;
  private readonly from: Vec3 = vec3();
  /** 進む向き（単位ベクトル） */
  private readonly dir: Vec3 = vec3(0, 0, -1);
  private readonly health: Health;

  constructor(private readonly config: TransportConfig = TRANSPORT_CONFIG) {
    this.health = new Health(config.maxHp);
    this.hitRadius = config.hitRadius;
    this.visualRadius = config.visualRadius;
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

  /** 経路の進み具合（0〜1） */
  get progress(): number {
    return this.length > 0 ? Math.min(1, this.traveled / this.length) : 1;
  }

  /** 進む向き（描画用） */
  get direction(): Readonly<Vec3> {
    return this.dir;
  }

  /** from に HP 満タンで出し、to へ向けて飛ばす */
  deploy(group: string, from: Readonly<Vec3>, to: Readonly<Vec3>): void {
    this.group = group;
    copyVec3(this.from, from);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    this.length = Math.hypot(dx, dy, dz);
    if (this.length > 1e-6) {
      this.dir.x = dx / this.length;
      this.dir.y = dy / this.length;
      this.dir.z = dz / this.length;
    }
    this.traveled = 0;
    this.health.reset();
    this.deployed = true;
    this.flashTimer = 0;
    this.place();
    copyVec3(this.prevPosition, this.position);
  }

  withdraw(): void {
    this.deployed = false;
    this.group = '';
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = this.config.hitFlashSeconds;
    return this.health.applyDamage(amount);
  }

  /** 固定ステップ 1 回分。経路の終点を過ぎても同じ向きに飛び続ける（着いたかどうかは護衛の目標が判定する） */
  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    copyVec3(this.prevPosition, this.position);
    if (!this.active) return;
    this.traveled += this.config.speed * dt;
    this.place();
  }

  private place(): void {
    const d = this.dir;
    const t = this.traveled;
    this.position.x = this.from.x + d.x * t;
    this.position.y = this.from.y + d.y * t;
    this.position.z = this.from.z + d.z * t;
    const v = this.active ? this.config.speed : 0;
    this.velocity.x = d.x * v;
    this.velocity.y = d.y * v;
    this.velocity.z = d.z * v;
  }
}

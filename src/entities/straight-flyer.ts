// 直進する敵（7-2 の爆撃機・巡航ミサイルの共通部分）。始点から決まった向きへ一定速度で進むだけで、旋回しない。
// 位置は「始点 + 向き × 進んだ距離」なので、始点・向き・経過時間が同じならどこで計算しても同じ（協力のクライアントが再現できる）。
// CombatTarget を実装（陣営は敵）。Three.js 非依存
import { Health } from '../combat/damage';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import { copyVec3, vec3, type Vec3 } from '../flight/math';

export interface StraightFlyerSpec {
  readonly speed: number;
  readonly maxHp: number;
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly hitFlashSeconds: number;
}

export class StraightFlyer implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  readonly team = TEAM_ENEMY;
  readonly hitRadius: number;
  readonly visualRadius: number;
  /** 出ているか（撃墜・離脱・着弾で false） */
  deployed = false;
  /** 進んだ距離と、離脱（巡航ミサイルは着弾）までの距離 */
  traveled = 0;
  length = 0;
  flashTimer = 0;
  /** 波の通し番号（どの波の敵か。波の終わりの判定） */
  wave = 0;
  readonly from: Vec3 = vec3();
  /** 進む向き（単位ベクトル） */
  readonly direction: Vec3 = vec3(0, 0, -1);
  private health: Health;

  constructor(readonly spec: StraightFlyerSpec) {
    this.health = new Health(spec.maxHp);
    this.hitRadius = spec.hitRadius;
    this.visualRadius = spec.visualRadius;
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

  /** 終点（length）まで進んだ */
  get arrived(): boolean {
    return this.traveled >= this.length;
  }

  /** from から direction（単位ベクトル）へ length 進むまで飛ばす。HP 満タン */
  launch(from: Readonly<Vec3>, direction: Readonly<Vec3>, length: number, wave: number): void {
    copyVec3(this.from, from);
    copyVec3(this.direction, direction);
    this.length = length;
    this.traveled = 0;
    this.wave = wave;
    this.health.reset();
    this.deployed = true;
    this.flashTimer = 0;
    this.place();
    copyVec3(this.prevPosition, this.position);
  }

  withdraw(): void {
    this.deployed = false;
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = this.spec.hitFlashSeconds;
    return this.health.applyDamage(amount);
  }

  /** 撃墜の表示（協力のクライアント: ホストの判定を映す） */
  markDestroyed(): void {
    this.health.applyDamage(this.health.hp);
  }

  /** 固定ステップ 1 回分 */
  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    copyVec3(this.prevPosition, this.position);
    if (!this.active) return;
    this.traveled = Math.min(this.length, this.traveled + this.spec.speed * dt);
    this.place();
  }

  /** 進んだ距離の位置に置く（協力のクライアントの再現） */
  setTraveled(traveled: number): void {
    copyVec3(this.prevPosition, this.position);
    this.traveled = Math.max(0, Math.min(this.length, traveled));
    this.place();
  }

  private place(): void {
    const d = this.direction;
    const t = this.traveled;
    this.position.x = this.from.x + d.x * t;
    this.position.y = this.from.y + d.y * t;
    this.position.z = this.from.z + d.z * t;
    const v = this.active ? this.spec.speed : 0;
    this.velocity.x = d.x * v;
    this.velocity.y = d.y * v;
    this.velocity.z = d.z * v;
  }
}

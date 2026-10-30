// 怪獣の仮実装（2-5、M5。6-1 で部位 HP・モデル付きの本実装に置き換える）。
// 海から浮かび上がり（rising）、島に向かってゆっくり歩き（walking）、HP を一定の割合削られると
// 海へ引き返して沈む（retreating → gone）。攻撃しない。全体の HP だけを持ち、撃墜はされない
import type { CombatTarget } from '../combat/target';
import { KAIJU_PLACEHOLDER_CONFIG } from '../data/mission-props';
import { clamp, copyVec3, vec3, type Vec3 } from '../flight/math';
import type { GroundHeightFn } from './aircraft';

export type KaijuConfig = typeof KAIJU_PLACEHOLDER_CONFIG;
export type KaijuPhase = 'hidden' | 'rising' | 'walking' | 'retreating' | 'gone';

export class KaijuPlaceholder implements CombatTarget {
  /** 当たり判定の球の中心（足元から centerHeight 上） */
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  /** 足元（描画の基準）。前ステップの値は補間用 */
  readonly feet: Vec3 = vec3();
  readonly prevFeet: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  phase: KaijuPhase = 'hidden';
  /** 今の段階に入ってからの時間 */
  phaseTime = 0;
  flashTimer = 0;
  /** 向いている方位（水平の単位ベクトル。描画用） */
  readonly facing: Vec3 = vec3(0, 0, -1);
  private hpValue: number;
  private retreatRatio = 1;
  private readonly origin: Vec3 = vec3();
  private readonly goal: Vec3 = vec3();

  constructor(
    private readonly groundHeight: GroundHeightFn = () => 0,
    private readonly config: KaijuConfig = KAIJU_PLACEHOLDER_CONFIG,
  ) {
    this.hpValue = config.maxHp;
    this.hitRadius = config.hitRadius;
    this.visualRadius = config.visualRadius;
  }

  get hp(): number {
    return this.hpValue;
  }

  get maxHp(): number {
    return this.config.maxHp;
  }

  /** 撃墜はされない（撤退させるのが目標） */
  get isDestroyed(): boolean {
    return false;
  }

  /** 撃てる・ロックできるのは浮かび上がっている間と歩いている間 */
  get active(): boolean {
    return this.phase === 'rising' || this.phase === 'walking';
  }

  /** 見えているか（描画） */
  get visible(): boolean {
    return this.phase !== 'hidden' && this.phase !== 'gone';
  }

  /** 与えたダメージの割合（0〜1） */
  get damageRatio(): number {
    return 1 - this.hpValue / this.config.maxHp;
  }

  /** 海の (x, z) に浮かび上がり始め、walkTo へ歩く。retreatRatio のダメージで引き返す */
  emerge(x: number, z: number, walkToX: number, walkToZ: number, retreatRatio: number): void {
    this.hpValue = this.config.maxHp;
    this.retreatRatio = retreatRatio;
    this.origin.x = x;
    this.origin.z = z;
    this.goal.x = walkToX;
    this.goal.z = walkToZ;
    this.feet.x = x;
    this.feet.z = z;
    this.faceToward(walkToX, walkToZ);
    this.enter('rising');
    this.flashTimer = 0;
    this.place(this.floorAt(x, z) - this.config.height);
    copyVec3(this.prevFeet, this.feet);
    copyVec3(this.prevPosition, this.position);
  }

  /** 引っ込める（ミッションの開始・フリーフライト） */
  withdraw(): void {
    this.phase = 'hidden';
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }

  /** ダメージを受ける。HP は 0 にならない（撃墜されない）ので常に false */
  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = this.config.hitFlashSeconds;
    this.hpValue = Math.max(1, this.hpValue - amount);
    if (this.damageRatio >= this.retreatRatio - 1e-9) this.retreat();
    return false;
  }

  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    copyVec3(this.prevFeet, this.feet);
    copyVec3(this.prevPosition, this.position);
    if (!this.visible) return;
    this.phaseTime += dt;
    const c = this.config;
    const f = this.feet;
    switch (this.phase) {
      case 'rising': {
        const floor = this.floorAt(f.x, f.z);
        // 固定ステップの足し算の誤差で 1 にわずかに届かないのを防ぐ
        const t = clamp(this.phaseTime / c.riseSeconds + 1e-9, 0, 1);
        this.place(floor - c.height * (1 - t));
        this.velocity.x = this.velocity.z = 0;
        this.velocity.y = c.height / c.riseSeconds;
        if (t >= 1) this.enter('walking');
        break;
      }
      case 'walking':
        this.walk(this.goal, c.walkSpeed, dt, 0);
        break;
      case 'retreating': {
        // 海へ戻りながら sinkSeconds で頭まで沈む
        const sink = c.height * clamp(this.phaseTime / c.sinkSeconds, 0, 1);
        this.walk(this.origin, c.retreatSpeed, dt, sink);
        if (this.phaseTime >= c.sinkSeconds) this.withdrawTo('gone');
        break;
      }
    }
  }

  /** 引き返す（ダメージで自分から、またはミッションの都合で） */
  retreat(): void {
    if (!this.active) return;
    this.faceToward(this.origin.x, this.origin.z);
    this.enter('retreating');
  }

  private withdrawTo(phase: KaijuPhase): void {
    this.phase = phase;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }

  private enter(phase: KaijuPhase): void {
    this.phase = phase;
    this.phaseTime = 0;
  }

  /** to へ水平に speed で歩く（着いたら止まる）。足元は地表（海の上は海面）から sink 下 */
  private walk(to: Readonly<Vec3>, speed: number, dt: number, sink: number): void {
    const f = this.feet;
    const dx = to.x - f.x;
    const dz = to.z - f.z;
    const d = Math.hypot(dx, dz);
    const move = Math.min(d, speed * dt);
    const vx = d > 1e-6 ? (dx / d) * (move / dt) : 0;
    const vz = d > 1e-6 ? (dz / d) * (move / dt) : 0;
    const y0 = f.y;
    f.x += vx * dt;
    f.z += vz * dt;
    this.place(this.floorAt(f.x, f.z) - sink);
    this.velocity.x = vx;
    this.velocity.y = (f.y - y0) / dt;
    this.velocity.z = vz;
  }

  /** 足元の高さを y にし、当たり判定の中心を合わせる */
  private place(y: number): void {
    this.feet.y = y;
    this.position.x = this.feet.x;
    this.position.y = y + this.config.centerHeight;
    this.position.z = this.feet.z;
  }

  /** 立つ高さ: 島の上は地表、海の上は海面（海底を歩いても胴は水の上に出す） */
  private floorAt(x: number, z: number): number {
    return Math.max(0, this.groundHeight(x, z));
  }

  private faceToward(x: number, z: number): void {
    const dx = x - this.feet.x;
    const dz = z - this.feet.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return;
    this.facing.x = dx / d;
    this.facing.z = dz / d;
  }
}

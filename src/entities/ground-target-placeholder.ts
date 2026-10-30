// 地上目標の仮置き（2-5、M4）。2-6 で地上目標（建物・車両）と無誘導兵器を作るまでの「静止した大きな的」。
// 地表に置いた箱で、機銃・ミサイルで壊せる。再出現しない
import { Health } from '../combat/damage';
import type { CombatTarget } from '../combat/target';
import { GROUND_TARGET_PLACEHOLDER_CONFIG } from '../data/mission-props';
import { vec3, type Vec3 } from '../flight/math';
import type { GroundHeightFn } from './aircraft';

export type GroundTargetConfig = typeof GROUND_TARGET_PLACEHOLDER_CONFIG;

const ZERO: Readonly<Vec3> = { x: 0, y: 0, z: 0 };

export class GroundTargetPlaceholder implements CombatTarget {
  /** 箱の中心（地表 + 高さの半分） */
  readonly position: Vec3 = vec3();
  readonly velocity: Readonly<Vec3> = ZERO;
  readonly hitRadius: number;
  readonly visualRadius: number;
  deployed = false;
  group = '';
  targetType = '';
  flashTimer = 0;
  private readonly health: Health;

  constructor(
    private readonly groundHeight: GroundHeightFn = () => 0,
    private readonly config: GroundTargetConfig = GROUND_TARGET_PLACEHOLDER_CONFIG,
  ) {
    this.health = new Health(config.maxHp);
    this.hitRadius = config.hitRadius;
    this.visualRadius = config.visualRadius;
  }

  /** 動かないので前ステップの位置も同じ */
  get prevPosition(): Readonly<Vec3> {
    return this.position;
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

  /** (x, z) の地表に HP 満タンで置く。海の上なら海面に置く */
  deploy(group: string, targetType: string, x: number, z: number): void {
    this.group = group;
    this.targetType = targetType;
    this.position.x = x;
    this.position.y = Math.max(0, this.groundHeight(x, z)) + this.config.size.height / 2;
    this.position.z = z;
    this.health.reset();
    this.deployed = true;
    this.flashTimer = 0;
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

  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
  }
}

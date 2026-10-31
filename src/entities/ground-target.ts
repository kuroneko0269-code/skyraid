// 地上目標（2-6。2-5 の仮置き ground-target-placeholder.ts を置き換え）: レーダー・燃料タンク・格納庫・対空砲。
// 地表の最も低い所（足元の四隅と中心）に立てる。動かない・再出現しない。燃料タンクは壊れると周囲に範囲ダメージ。
// 対空砲の射撃は src/combat/aaa.ts（砲身の向き・撃つ間隔の状態はここに持つ）。Three.js 非依存
import { Health } from '../combat/damage';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import type { Difficulty } from '../data/ai';
import {
  FUEL_TANK_BLAST,
  GROUND_TARGET_CONFIG,
  GROUND_TARGET_SPECS,
  type BlastSpec,
  type GroundTargetSpec,
  type GroundTargetType,
} from '../data/ground-targets';
import { vec3, type Vec3 } from '../flight/math';
import type { GroundHeightFn } from './aircraft';

const ZERO: Readonly<Vec3> = { x: 0, y: 0, z: 0 };

/** 対空砲の照準と射撃の状態（対空砲以外は使わない） */
export interface AaaGunState {
  /** 自機が射程内で追っているか */
  tracking: boolean;
  /** 次のバーストまでの時間 */
  timer: number;
  /** このバーストの残りの弾数と、次の弾までの時間 */
  burstLeft: number;
  shotTimer: number;
  /** 砲身の向き（方位: -Z から +X へ回る向きが正 / 仰角）。描画が読む */
  yaw: number;
  pitch: number;
}

export class GroundTarget implements CombatTarget {
  /** 当たり判定の球の中心（足元 + centerHeight） */
  readonly position: Vec3 = vec3();
  /** 足元（地表の最も低い所） */
  readonly base: Vec3 = vec3();
  readonly velocity: Readonly<Vec3> = ZERO;
  type: GroundTargetType = 'radar';
  spec: GroundTargetSpec = GROUND_TARGET_SPECS.radar;
  difficulty: Difficulty = 'normal';
  /** 陣営（7-2: 防衛戦の基地は味方。既定は敵） */
  team = TEAM_ENEMY;
  /** 置いた向き（方位、rad）。見た目だけ */
  heading = 0;
  deployed = false;
  group = '';
  flashTimer = 0;
  /** レーダーのアンテナの角度（rad） */
  dishAngle = 0;
  /** 壊れてからの時間（黒煙の演出。壊れていなければ 0） */
  wreckSeconds = 0;
  readonly gun: AaaGunState = {
    tracking: false,
    timer: 0,
    burstLeft: 0,
    shotTimer: 0,
    yaw: 0,
    pitch: 0,
  };
  private health = new Health(GROUND_TARGET_SPECS.radar.maxHp);

  constructor(private readonly groundHeight: GroundHeightFn = () => 0) {}

  /** 動かないので前ステップの位置も同じ */
  get prevPosition(): Readonly<Vec3> {
    return this.position;
  }

  get hitRadius(): number {
    return this.spec.hitRadius;
  }

  get visualRadius(): number {
    return this.spec.visualRadius;
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

  /** 出ていて壊れている（残骸と黒煙を描く） */
  get wrecked(): boolean {
    return this.deployed && this.health.isDestroyed;
  }

  /** 壊れたときの範囲ダメージ（燃料タンクだけ） */
  get deathBlast(): BlastSpec | null {
    return this.type === 'fuelTank' ? FUEL_TANK_BLAST : null;
  }

  /** (x, z) の地表に HP 満タンで立てる。足元の四隅と中心のうち最も低い地表（海の上なら海面）に置く */
  deploy(
    group: string,
    type: GroundTargetType,
    x: number,
    z: number,
    difficulty: Difficulty = 'normal',
    heading = 0,
  ): void {
    this.group = group;
    this.type = type;
    this.spec = GROUND_TARGET_SPECS[type];
    this.difficulty = difficulty;
    this.heading = heading;
    const r = this.spec.footprint;
    let y = this.floor(x, z);
    for (const [dx, dz] of CORNERS) y = Math.min(y, this.floor(x + dx * r, z + dz * r));
    this.base.x = x;
    this.base.y = y;
    this.base.z = z;
    this.position.x = x;
    this.position.y = y + this.spec.centerHeight;
    this.position.z = z;
    this.team = TEAM_ENEMY;
    if (this.health.maxHp !== this.spec.maxHp) this.health = new Health(this.spec.maxHp);
    this.health.reset();
    this.deployed = true;
    this.flashTimer = 0;
    this.dishAngle = 0;
    this.wreckSeconds = 0;
    const g = this.gun;
    g.tracking = false;
    g.timer = g.shotTimer = 0;
    g.burstLeft = 0;
    g.yaw = heading;
    g.pitch = 0.5;
  }

  withdraw(): void {
    this.deployed = false;
    this.group = '';
    this.team = TEAM_ENEMY;
  }

  /** 陣営と最大 HP を変える（7-2: 防衛戦の基地。deploy の後に呼ぶ。HP は満タン） */
  configure(team: number, maxHp: number = this.spec.maxHp): void {
    this.team = team;
    if (this.health.maxHp !== maxHp) this.health = new Health(maxHp);
    this.health.reset();
  }

  /** HP をそのまま映す（協力のクライアント: ホストの判定を表示する） */
  mirrorHp(hp: number): void {
    const d = this.health.hp - Math.max(0, hp);
    if (d > 0) this.applyDamage(d);
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = GROUND_TARGET_CONFIG.hitFlashSeconds;
    return this.health.applyDamage(amount);
  }

  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (this.wrecked) this.wreckSeconds += dt;
    else if (this.active && this.type === 'radar')
      this.dishAngle = (this.dishAngle + GROUND_TARGET_CONFIG.dishTurnRate * dt) % (Math.PI * 2);
  }

  private floor(x: number, z: number): number {
    return Math.max(0, this.groundHeight(x, z));
  }
}

const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

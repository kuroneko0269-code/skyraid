// 射撃練習用の的（風船）。島の上空でゆっくり上下し、撃墜されると時間をおいて別の地点に再出現する
import { Health } from '../combat/damage';
import type { CombatTarget } from '../combat/target';
import { TARGET_CONFIG, type TargetSpawnPoint } from '../data/targets';
import { copyVec3, vec3, type Vec3 } from '../flight/math';

export type TargetConfig = typeof TARGET_CONFIG;
/** (x, z) の地表の高さ（m）。海の上なら海面 */
export type GroundHeightFn = (x: number, z: number) => number;
export type Rng = () => number;

// 的ごとの揺れの位相をずらす（黄金角）。全部が同時に上下しないように
const PHASE_STEP = 2.399963;

export class TargetBalloon implements CombatTarget {
  readonly position: Vec3 = vec3();
  /** 前ステップの位置（描画の補間用） */
  readonly prevPosition: Vec3 = vec3();
  /** 速度（上下の揺れだけ） */
  readonly velocity: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  /** 今いる出現地点（spawnPoints の番号） */
  spawnIndex = -1;
  /** 再出現までの残り時間（秒）。撃墜されていないときは 0 */
  respawnTimer = 0;
  /** 被弾で白く光る残り時間（秒） */
  flashTimer = 0;
  /** 出ているか（ミッションで使わない的は引っ込める。2-4） */
  deployed = true;
  private readonly health: Health;
  private baseY = 0;

  constructor(
    private readonly config: TargetConfig,
    readonly phase: number,
  ) {
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

  /** 当たり判定を行うか（GunTarget） */
  get active(): boolean {
    return this.deployed && !this.health.isDestroyed;
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = this.config.hitFlashSeconds;
    const destroyed = this.health.applyDamage(amount);
    if (destroyed) this.respawnTimer = this.config.respawnSeconds;
    return destroyed;
  }

  /** 地点に HP 満タンで出す（補間しない） */
  place(index: number, point: TargetSpawnPoint, groundY: number, time: number): void {
    this.spawnIndex = index;
    this.health.reset();
    this.respawnTimer = 0;
    this.flashTimer = 0;
    this.baseY = groundY + point.agl;
    this.position.x = point.x;
    this.position.z = point.z;
    this.position.y = this.bobY(time);
    this.velocity.y = this.bobVelocity(time);
    copyVec3(this.prevPosition, this.position);
  }

  /** 揺れを time（秒）の位置に進める */
  move(time: number): void {
    copyVec3(this.prevPosition, this.position);
    this.position.y = this.bobY(time);
    this.velocity.y = this.bobVelocity(time);
  }

  private bobY(time: number): number {
    const b = this.config.bob;
    return this.baseY + b.amplitude * Math.sin((2 * Math.PI * time) / b.period + this.phase);
  }

  private bobVelocity(time: number): number {
    const b = this.config.bob;
    const w = (2 * Math.PI) / b.period;
    return b.amplitude * w * Math.cos(w * time + this.phase);
  }
}

/**
 * 的の集まり。最初は spawnPoints の先頭から count 個に置き、撃墜された的は
 * respawnSeconds 後に「どの的もいない、直前とも違う地点」へ再出現させる
 */
export class TargetField {
  readonly balloons: TargetBalloon[];
  private time = 0;
  /** 出す数と、撃墜された的を再出現させるか（フリーフライトは全部・再出現、ミッションは定義どおり・再出現なし） */
  private deployCount: number;
  private respawns = true;

  constructor(
    private readonly groundHeight: GroundHeightFn = () => 0,
    private readonly rng: Rng = Math.random,
    private readonly config: TargetConfig = TARGET_CONFIG,
  ) {
    if (config.spawnPoints.length <= config.count) {
      throw new Error('出現地点は的の数より多くする（再出現で別の地点を選ぶため）');
    }
    this.balloons = Array.from(
      { length: config.count },
      (_, i) => new TargetBalloon(config, i * PHASE_STEP),
    );
    this.deployCount = config.count;
    this.reset();
  }

  /** 出す数（先頭から）と再出現の有無を変え、最初の地点に置き直す */
  configure(count: number, respawns: boolean): void {
    this.deployCount = Math.max(0, Math.min(count, this.balloons.length));
    this.respawns = respawns;
    this.reset();
  }

  /** 全部の的を最初の地点に HP 満タンで戻す（出す数を超える的は引っ込める） */
  reset(): void {
    this.time = 0;
    this.balloons.forEach((b, i) => {
      this.placeAt(b, i);
      b.deployed = i < this.deployCount;
    });
  }

  step(dt: number): void {
    this.time += dt;
    for (const b of this.balloons) {
      if (b.flashTimer > 0) b.flashTimer = Math.max(0, b.flashTimer - dt);
      if (!b.deployed) continue;
      if (b.isDestroyed) {
        if (!this.respawns) continue;
        b.respawnTimer -= dt;
        if (b.respawnTimer <= 0) this.placeAt(b, this.pickSpawn(b.spawnIndex));
      } else {
        b.move(this.time);
      }
    }
  }

  /** 空いている地点からランダムに選ぶ。exclude（直前にいた地点）は選ばない */
  private pickSpawn(exclude: number): number {
    const n = this.config.spawnPoints.length;
    let free = 0;
    for (let i = 0; i < n; i++) if (this.isFree(i, exclude)) free++;
    let k = Math.min(free - 1, Math.floor(this.rng() * free));
    for (let i = 0; i < n; i++) {
      if (!this.isFree(i, exclude)) continue;
      if (k === 0) return i;
      k--;
    }
    return exclude;
  }

  private isFree(index: number, exclude: number): boolean {
    if (index === exclude) return false;
    return !this.balloons.some((b) => b.deployed && b.spawnIndex === index);
  }

  private placeAt(b: TargetBalloon, index: number): void {
    const point = this.config.spawnPoints[index];
    if (!point) return;
    b.place(index, point, this.groundHeight(point.x, point.z), this.time);
  }
}

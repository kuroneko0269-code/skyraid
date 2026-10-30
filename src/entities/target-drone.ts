// ロック練習用の周回ドローン（2-2）。一定高度・一定速度で円を描く固定経路（AI は 2-3）
import { Health } from '../combat/damage';
import type { CombatTarget } from '../combat/target';
import { DRONE_CONFIG, type DroneOrbit } from '../data/targets';
import { copyVec3, vec3, type Vec3 } from '../flight/math';

export type DroneConfig = typeof DRONE_CONFIG;

export class TargetDrone implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  /** 軌道上の角度（rad）。撃墜中も進み続け、再出現はその時点の位置 */
  angle: number;
  /** 再出現までの残り時間（秒）。撃墜されていないときは 0 */
  respawnTimer = 0;
  /** 被弾で白く光る残り時間（秒） */
  flashTimer = 0;
  /** 出ているか・撃墜されたら再出現するか（ミッションでは定義どおりの数・再出現なし。2-4） */
  deployed = true;
  respawns = true;
  private readonly health: Health;

  constructor(
    readonly orbit: DroneOrbit,
    private readonly config: DroneConfig = DRONE_CONFIG,
  ) {
    this.health = new Health(config.maxHp);
    this.hitRadius = config.hitRadius;
    this.visualRadius = config.visualRadius;
    this.angle = orbit.phase;
    this.reset();
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

  /** 角速度（rad/s）。上から見て反時計回り */
  get angularSpeed(): number {
    return this.config.speed / this.orbit.radius;
  }

  applyDamage(amount: number): boolean {
    if (!this.active || !(amount > 0)) return false;
    this.flashTimer = this.config.hitFlashSeconds;
    const destroyed = this.health.applyDamage(amount);
    if (destroyed) this.respawnTimer = this.config.respawnSeconds;
    return destroyed;
  }

  /** 開始時の角度に HP 満タンで置く（補間しない） */
  reset(): void {
    this.health.reset();
    this.respawnTimer = 0;
    this.flashTimer = 0;
    this.angle = this.orbit.phase;
    this.place();
    copyVec3(this.prevPosition, this.position);
  }

  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    copyVec3(this.prevPosition, this.position);
    this.angle += this.angularSpeed * dt;
    if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;
    this.place();
    if (this.isDestroyed && this.respawns) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.health.reset();
        this.respawnTimer = 0;
        // 消えていた間に動いた分は補間しない
        copyVec3(this.prevPosition, this.position);
      }
    }
  }

  private place(): void {
    const o = this.orbit;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    this.position.x = o.centerX + o.radius * c;
    this.position.y = o.altitude;
    this.position.z = o.centerZ + o.radius * s;
    // θ の微分（接線方向）× 速さ
    const v = this.config.speed;
    this.velocity.x = -s * v;
    this.velocity.y = 0;
    this.velocity.z = c * v;
  }
}

/** 軌道ごとに 1 機ずつ */
export function createDrones(config: DroneConfig = DRONE_CONFIG): TargetDrone[] {
  return config.orbits.map((orbit) => new TargetDrone(orbit, config));
}

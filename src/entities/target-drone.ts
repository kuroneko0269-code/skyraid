// ロック練習用の周回ドローン（2-2）。一定高度・一定速度で円を描く固定経路（AI は 2-3）。
// 9-5: 練習場の「動く的」は経路（path。直進・蛇行・上下）を差し込む。null なら今までどおりの周回
import { Health } from '../combat/damage';
import type { CombatTarget } from '../combat/target';
import type { DronePathDef } from '../data/practice';
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
  /** 練習場の経路（9-5）。null は周回 */
  path: DronePathDef | null = null;
  /** 経路の上の時間（秒。撃墜・端で 0 に戻る） */
  pathTime = 0;
  /** 経路のときの傾き（rad。右翼が下がる向きが正。蛇行の横の加速度から） */
  pathBank = 0;
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
    if (destroyed) this.respawnTimer = this.path?.respawnSeconds ?? this.config.respawnSeconds;
    return destroyed;
  }

  /** 開始時の角度（経路なら始め）に HP 満タンで置く（補間しない） */
  reset(): void {
    this.health.reset();
    this.respawnTimer = 0;
    this.flashTimer = 0;
    this.angle = this.orbit.phase;
    this.pathTime = 0;
    this.place();
    copyVec3(this.prevPosition, this.position);
  }

  /** 経路を差し込む（9-5。null で周回に戻す）。始めに置き直す */
  setPath(path: DronePathDef | null): void {
    this.path = path;
    this.reset();
  }

  step(dt: number): void {
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    copyVec3(this.prevPosition, this.position);
    const path = this.path;
    if (path) {
      this.pathTime += dt;
      // 端まで行ったら始めへ（撃墜ではない。補間しない）
      if (this.pathTime * path.speed >= path.length) {
        this.pathTime = 0;
        this.placePath(path);
        copyVec3(this.prevPosition, this.position);
      } else this.placePath(path);
    } else {
      this.angle += this.angularSpeed * dt;
      if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;
      this.place();
    }
    if (this.isDestroyed && this.respawns) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.health.reset();
        this.respawnTimer = 0;
        // 経路は始めから出直す
        if (path) {
          this.pathTime = 0;
          this.placePath(path);
        }
        // 消えていた間に動いた分は補間しない
        copyVec3(this.prevPosition, this.position);
      }
    }
  }

  private place(): void {
    if (this.path) {
      this.placePath(this.path);
      return;
    }
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

  /** 経路の pathTime の位置・速度・傾き（9-5） */
  private placePath(path: DronePathDef): void {
    const h = (path.headingDeg * Math.PI) / 180;
    // 進む向き（-Z から右回り）と右手の向き（水平）
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    const t = this.pathTime;
    const along = path.speed * t;
    let side = 0;
    let sideV = 0;
    let sideA = 0;
    const w = path.weave;
    if (w) {
      const k = (2 * Math.PI) / w.period;
      side = w.amplitude * Math.sin(k * t);
      sideV = w.amplitude * k * Math.cos(k * t);
      sideA = -w.amplitude * k * k * Math.sin(k * t);
    }
    let up = 0;
    let upV = 0;
    const b = path.bob;
    if (b) {
      const k = (2 * Math.PI) / b.period;
      up = b.amplitude * Math.sin(k * t);
      upV = b.amplitude * k * Math.cos(k * t);
    }
    this.position.x = path.from.x + fx * along + rx * side;
    this.position.y = path.from.y + up;
    this.position.z = path.from.z + fz * along + rz * side;
    this.velocity.x = fx * path.speed + rx * sideV;
    this.velocity.y = upV;
    this.velocity.z = fz * path.speed + rz * sideV;
    // 右へ曲がる（横の加速度が右向き）ときは右翼を下げる
    this.pathBank = Math.atan(sideA / 9.8);
  }
}

/** 軌道ごとに 1 機ずつ */
export function createDrones(config: DroneConfig = DRONE_CONFIG): TargetDrone[] {
  return config.orbits.map((orbit) => new TargetDrone(orbit, config));
}

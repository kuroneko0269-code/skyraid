// 無誘導ロケット（2-6。Three.js 非依存）: 左右の翼下から 2 発同時に、機首方向へ 350 m/s + 機速で撃つ。
// 重力で落ちながら直進し、対象の球・地面に当たると起爆（表面から 5m 以内の敵側に 60）。12 発 = 6 斉射
import { ROCKET_CONFIG } from '../data/ordnance';
import { LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP } from '../flight/flight-model';
import { rotateVec3, vec3 } from '../flight/math';
import type { GroundHeightFn, Rng, Shooter } from './gun';
import { Pool } from './pool';
import {
  findImpact,
  moveBallistic,
  newProjectile,
  type Impact,
  type Projectile,
} from './projectile';
import type { CombatTarget } from './target';

export type RocketSpec = typeof ROCKET_CONFIG;

const DEG = Math.PI / 180;

export class RocketPod {
  readonly rockets: Pool<Projectile>;
  private remaining: number;
  private cooldown = 0;
  private readonly impact: Impact = { x: 0, y: 0, z: 0, target: null };
  private readonly f = vec3();
  private readonly r = vec3();
  private readonly u = vec3();
  private readonly offset = vec3();
  private readonly spreadTan: number;

  constructor(
    private readonly onImpact: (impact: Readonly<Impact>) => void = () => undefined,
    private readonly groundHeight: GroundHeightFn | null = null,
    private readonly rng: Rng = Math.random,
    readonly spec: RocketSpec = ROCKET_CONFIG,
  ) {
    this.rockets = new Pool(spec.maxRockets, newProjectile);
    this.remaining = spec.ammo;
    this.spreadTan = Math.tan(spec.spreadDeg * DEG);
  }

  /** 残弾（発） */
  get count(): number {
    return this.remaining;
  }

  refill(): void {
    this.remaining = this.spec.ammo;
    this.cooldown = 0;
  }

  reset(): void {
    this.refill();
    this.rockets.clear();
  }

  /** 撃てるなら 1 斉射（perSalvo 発、残りが少なければ残り全部）して true */
  tryFire(shooter: Shooter): boolean {
    if (this.remaining <= 0 || this.cooldown > 0) return false;
    const n = Math.min(this.spec.perSalvo, this.remaining);
    for (let i = 0; i < n; i++) this.launch(shooter, i % 2 === 0 ? -1 : 1);
    this.remaining -= n;
    this.cooldown = this.spec.fireInterval;
    return true;
  }

  /** 固定ステップ 1 回分。targets のうち isHostile が true のものに当たる */
  step(
    targets: readonly CombatTarget[],
    isHostile: (t: CombatTarget) => boolean,
    dt: number,
  ): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt - 1e-12);
    const pool = this.rockets;
    for (let i = pool.count - 1; i >= 0; i--) {
      const p = pool.get(i);
      moveBallistic(p, this.spec.gravity, dt);
      if (findImpact(p, targets, isHostile, this.groundHeight, this.impact)) {
        this.onImpact(this.impact);
        pool.release(i);
      } else if (p.age >= this.spec.life) pool.release(i);
    }
  }

  private launch(shooter: Shooter, side: number): void {
    const p = this.rockets.acquire();
    if (!p) return;
    const q = shooter.orientation;
    const f = rotateVec3(this.f, q, LOCAL_FORWARD);
    const r = rotateVec3(this.r, q, LOCAL_RIGHT);
    const u = rotateVec3(this.u, q, LOCAL_UP);
    const o = this.spec.launchOffset;
    this.offset.x = o.x * side;
    this.offset.y = o.y;
    this.offset.z = o.z;
    const m = rotateVec3(this.offset, q, this.offset);
    const sx = (this.rng() * 2 - 1) * this.spreadTan;
    const sy = (this.rng() * 2 - 1) * this.spreadTan;
    let dx = f.x + r.x * sx + u.x * sy;
    let dy = f.y + r.y * sx + u.y * sy;
    let dz = f.z + r.z * sx + u.z * sy;
    const len = Math.hypot(dx, dy, dz);
    dx /= len;
    dy /= len;
    dz /= len;
    const speed = shooter.speed + this.spec.muzzleSpeed;
    const s = shooter.position;
    p.x = p.px = s.x + m.x;
    p.y = p.py = s.y + m.y;
    p.z = p.pz = s.z + m.z;
    p.vx = dx * speed;
    p.vy = dy * speed;
    p.vz = dz * speed;
    p.age = 0;
  }
}

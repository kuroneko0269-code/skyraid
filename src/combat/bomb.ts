// 爆弾（2-6。Three.js 非依存）: 胴体の下から機体の速度のまま放し、重力だけで放物線を描いて落ちる。
// 対象の球・地面に当たると起爆（表面から 40m 以内の敵側すべてに 300）。4 発。
// 着弾予測点（HUD の ○）は同じ放物線を地表と交差するまで進めて求める（predictImpact）。地面への着弾も同じ関数で
// 詰めるので、予測点と実際の着弾は一致する
import { BOMB_CONFIG, BOMB_PREDICTOR_CONFIG } from '../data/ordnance';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { rotateVec3, vec3, type Vec3 } from '../flight/math';
import { segmentSphere } from './collision';
import type { GroundHeightFn, Shooter } from './gun';
import { Magazine } from './magazine';
import { Pool } from './pool';
import { moveBallistic, newProjectile, type Impact, type Projectile } from './projectile';
import type { CombatTarget } from './target';

export type BombSpec = typeof BOMB_CONFIG;
export type BombPredictorSpec = typeof BOMB_PREDICTOR_CONFIG;

/** 爆弾 1 発。投下した位置・速度（o*）を覚えておき、地面との交点を放物線の式で詰める */
export interface Bomb extends Projectile {
  ox: number;
  oy: number;
  oz: number;
  ovx: number;
  ovy: number;
  ovz: number;
}

function newBomb(): Bomb {
  return { ...newProjectile(), ox: 0, oy: 0, oz: 0, ovx: 0, ovy: 0, ovz: 0 };
}

/** 放物線（投下点 o・初速 v・重力 g）の t 秒後の高さと地表の差（正なら地表より上） */
function clearance(
  o: Readonly<Vec3>,
  v: Readonly<Vec3>,
  g: number,
  ground: GroundHeightFn,
  t: number,
): number {
  const y = o.y + v.y * t - 0.5 * g * t * t;
  return y - ground(o.x + v.x * t, o.z + v.z * t);
}

/**
 * 放物線が地表と交差する時間を [t0, t1] の中で二分法で詰める（t0 で地表より上、t1 で地表以下）。
 * 交点の位置を out に書いて、その時間を返す
 */
export function refineGroundCrossing(
  out: Vec3,
  o: Readonly<Vec3>,
  v: Readonly<Vec3>,
  g: number,
  ground: GroundHeightFn,
  t0: number,
  t1: number,
  iterations: number = BOMB_PREDICTOR_CONFIG.bisections,
): number {
  let lo = t0;
  let hi = t1;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (clearance(o, v, g, ground, mid) > 0) lo = mid;
    else hi = mid;
  }
  const t = hi;
  out.x = o.x + v.x * t;
  out.z = o.z + v.z * t;
  out.y = ground(out.x, out.z);
  return t;
}

/**
 * 着弾予測点: 投下点 o・初速 v の放物線が地表と交差する点を out に書き、落下時間を返す。
 * spec.maxSeconds 以内に交差しなければ -1（out は書かない）
 */
export function predictImpact(
  out: Vec3,
  o: Readonly<Vec3>,
  v: Readonly<Vec3>,
  g: number,
  ground: GroundHeightFn,
  spec: BombPredictorSpec = BOMB_PREDICTOR_CONFIG,
): number {
  if (clearance(o, v, g, ground, 0) <= 0) return -1;
  let prev = 0;
  for (let t = spec.step; t <= spec.maxSeconds + 1e-9; t += spec.step) {
    if (clearance(o, v, g, ground, t) <= 0)
      return refineGroundCrossing(out, o, v, g, ground, prev, t, spec.bisections);
    prev = t;
  }
  return -1;
}

export class BombBay {
  readonly bombs: Pool<Bomb>;
  readonly magazine: Magazine;
  /** 今投下したときの着弾予測点（predictionValid のときだけ有効）と落下時間 */
  readonly prediction = vec3();
  predictionValid = false;
  predictionSeconds = 0;
  private readonly impact: Impact = { x: 0, y: 0, z: 0, target: null };
  private readonly origin = vec3();
  private readonly velocity = vec3();
  private readonly offset = vec3();
  private readonly point = vec3();

  constructor(
    private readonly onImpact: (impact: Readonly<Impact>) => void = () => undefined,
    private readonly groundHeight: GroundHeightFn | null = null,
    readonly spec: BombSpec = BOMB_CONFIG,
  ) {
    this.bombs = new Pool(spec.maxBombs, newBomb);
    this.magazine = new Magazine(spec.ammo, spec.dropInterval);
  }

  get count(): number {
    return this.magazine.count;
  }

  reset(): void {
    this.magazine.refill();
    this.bombs.clear();
    this.predictionValid = false;
  }

  /** 投下できるなら 1 発放して true */
  tryDrop(shooter: Shooter): boolean {
    if (!this.magazine.tryUse()) return false;
    const b = this.bombs.acquire();
    if (!b) return true;
    this.releaseState(shooter);
    b.x = b.px = b.ox = this.origin.x;
    b.y = b.py = b.oy = this.origin.y;
    b.z = b.pz = b.oz = this.origin.z;
    b.vx = b.ovx = this.velocity.x;
    b.vy = b.ovy = this.velocity.y;
    b.vz = b.ovz = this.velocity.z;
    b.age = 0;
    return true;
  }

  /** 固定ステップ 1 回分。飛んでいる爆弾を進め、着弾予測点を今の機体の状態で求め直す */
  step(
    shooter: Shooter | null,
    targets: readonly CombatTarget[],
    isHostile: (t: CombatTarget) => boolean,
    dt: number,
  ): void {
    this.magazine.step(dt);
    const pool = this.bombs;
    for (let i = pool.count - 1; i >= 0; i--) {
      const b = pool.get(i);
      moveBallistic(b, this.spec.gravity, dt);
      if (this.findImpact(b, targets, isHostile, dt)) {
        this.onImpact(this.impact);
        pool.release(i);
      } else if (b.age >= this.spec.life) pool.release(i);
    }
    this.predict(shooter);
  }

  private predict(shooter: Shooter | null): void {
    this.predictionValid = false;
    if (!shooter || !this.groundHeight || this.magazine.count <= 0) return;
    this.releaseState(shooter);
    const t = predictImpact(
      this.prediction,
      this.origin,
      this.velocity,
      this.spec.gravity,
      this.groundHeight,
    );
    this.predictionValid = t >= 0;
    this.predictionSeconds = Math.max(0, t);
  }

  /** 投下の位置・速度（機体の速度は機首方向） */
  private releaseState(shooter: Shooter): void {
    const q = shooter.orientation;
    const f = rotateVec3(this.velocity, q, LOCAL_FORWARD);
    this.velocity.x = f.x * shooter.speed;
    this.velocity.y = f.y * shooter.speed;
    this.velocity.z = f.z * shooter.speed;
    const m = rotateVec3(this.offset, q, this.spec.releaseOffset);
    const p = shooter.position;
    this.origin.x = p.x + m.x;
    this.origin.y = p.y + m.y;
    this.origin.z = p.z + m.z;
  }

  private findImpact(
    b: Bomb,
    targets: readonly CombatTarget[],
    isHostile: (t: CombatTarget) => boolean,
    dt: number,
  ): boolean {
    const hit = this.impact;
    let best = 2;
    let bestTarget: CombatTarget | null = null;
    for (const t of targets) {
      if (!t.active || !isHostile(t)) continue;
      const c = t.position;
      const s = segmentSphere(b.px, b.py, b.pz, b.x, b.y, b.z, c.x, c.y, c.z, t.hitRadius);
      if (s >= 0 && s < best) {
        best = s;
        bestTarget = t;
      }
    }
    if (bestTarget) {
      hit.target = bestTarget;
      hit.x = b.px + (b.x - b.px) * best;
      hit.y = b.py + (b.y - b.py) * best;
      hit.z = b.pz + (b.z - b.pz) * best;
      return true;
    }
    const ground = this.groundHeight;
    if (!ground || b.y > ground(b.x, b.z)) return false;
    // 放物線の式で地表との交点を詰める（着弾予測点と同じ計算）
    const o = this.origin;
    const v = this.velocity;
    o.x = b.ox;
    o.y = b.oy;
    o.z = b.oz;
    v.x = b.ovx;
    v.y = b.ovy;
    v.z = b.ovz;
    refineGroundCrossing(
      this.point,
      o,
      v,
      this.spec.gravity,
      ground,
      Math.max(0, b.age - dt),
      b.age,
    );
    hit.target = null;
    hit.x = this.point.x;
    hit.y = this.point.y;
    hit.z = this.point.z;
    return true;
  }
}

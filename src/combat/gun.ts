// 機銃（Three.js 非依存）。弾の移動・当たり判定は固定ステップで行う
import { GUN_CONFIG, type GunSpec } from '../data/weapons';
import { LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP } from '../flight/flight-model';
import { rotateVec3, vec3, type Quat, type Vec3 } from '../flight/math';
import { segmentSphere } from './collision';
import { GunHeat } from './heat';
import { Pool } from './pool';

/** 弾 1 発。p* は前ステップの位置（当たり判定の線分の始点、描画の補間にも使う） */
export interface Bullet {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  /** これまでに飛んだ距離（m） */
  traveled: number;
}

/** 機銃で撃てるもの。当たり判定は中心 position・半径 hitRadius の球 */
export interface GunTarget {
  readonly position: Readonly<Vec3>;
  readonly hitRadius: number;
  /** 当たり判定を行うか（撃墜済み・再出現待ちは false） */
  readonly active: boolean;
}

/** 撃つ機体の状態。速度は機首方向（横滑りなし） */
export interface Shooter {
  readonly position: Readonly<Vec3>;
  readonly orientation: Readonly<Quat>;
  readonly speed: number;
}

/** 命中の情報。オブジェクトは使い回すので保持しないこと。target が null なら地面・海面 */
export interface GunHit<T> {
  target: T | null;
  x: number;
  y: number;
  z: number;
}

export type GroundHeightFn = (x: number, z: number) => number;
export type Rng = () => number;

const DEG = Math.PI / 180;

/**
 * 機銃。引き金を引いている間 fireRate 発/秒で撃つ（熱ゲージが上限なら撃てない）。
 * 弾は重力で落ち、前ステップ位置 → 現在位置の線分と対象の球で当たり判定する
 */
export class Gun<T extends GunTarget> {
  readonly heat: GunHeat;
  readonly bullets: Pool<Bullet>;
  /** これまでに撃った弾数（マズルフラッシュの判定に使う） */
  shotCount = 0;
  /** これまでに対象に当たった弾数（命中音。4-12） */
  hitCount = 0;
  /** 対象の当たり判定の半径に掛ける倍率（タッチ・パッドのエイムアシスト。4-12。既定 1） */
  hitRadiusScale = 1;

  private cooldown = 0;
  private readonly hit: GunHit<T> = { target: null, x: 0, y: 0, z: 0 };
  private readonly forward = vec3();
  private readonly right = vec3();
  private readonly up = vec3();
  private readonly muzzle = vec3();
  private readonly spreadTan: number;

  constructor(
    readonly spec: GunSpec = GUN_CONFIG,
    private readonly onHit: (hit: Readonly<GunHit<T>>) => void = () => undefined,
    private readonly groundHeight: GroundHeightFn | null = null,
    private readonly rng: Rng = Math.random,
  ) {
    this.heat = new GunHeat(spec.heat);
    this.bullets = new Pool(spec.maxBullets, newBullet);
    this.spreadTan = Math.tan(spec.spreadDeg * DEG);
  }

  /** 固定ステップ 1 回分。飛んでいる弾を進めてから、引き金を引いていれば撃つ */
  step(trigger: boolean, shooter: Shooter, targets: readonly T[], dt: number): void {
    const pool = this.bullets;
    // 解放すると末尾が i 番目に来るので後ろから回す
    for (let i = pool.count - 1; i >= 0; i--) {
      if (this.advance(pool.get(i), targets, dt)) pool.release(i);
    }

    const interval = 1 / this.spec.fireRate;
    this.cooldown -= dt;
    if (!trigger) {
      // 離している間は貯めない（押した瞬間に 1 発目が出る）
      if (this.cooldown < 0) this.cooldown = 0;
    } else {
      while (this.cooldown <= 1e-9 && this.heat.canFire) {
        // lead: 撃った瞬間からこのステップの終わりまでの時間。その分だけ弾を先に進める
        this.fire(shooter, targets, -this.cooldown);
        this.cooldown += interval;
      }
      if (this.cooldown < 0) this.cooldown = 0;
    }
    this.heat.step(dt);
  }

  /** 弾と熱を消す（ミッション開始・リセット） */
  reset(): void {
    this.bullets.clear();
    this.heat.reset();
    this.cooldown = 0;
  }

  private fire(shooter: Shooter, targets: readonly T[], lead: number): void {
    const b = this.bullets.acquire();
    if (!b) return;
    const q = shooter.orientation;
    const f = rotateVec3(this.forward, q, LOCAL_FORWARD);
    const r = rotateVec3(this.right, q, LOCAL_RIGHT);
    const u = rotateVec3(this.up, q, LOCAL_UP);
    const m = rotateVec3(this.muzzle, q, this.spec.muzzleOffset);
    // 円錐の中のばらつき（正方形で近似）
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
    const p = shooter.position;
    b.x = b.px = p.x + m.x;
    b.y = b.py = p.y + m.y;
    b.z = b.pz = p.z + m.z;
    b.vx = dx * speed;
    b.vy = dy * speed;
    b.vz = dz * speed;
    b.traveled = 0;
    this.shotCount++;
    this.heat.addShot();
    if (lead > 0 && this.advance(b, targets, lead)) {
      // 撃った直後に当たった・消えた
      this.bullets.release(this.bullets.count - 1);
    }
  }

  /** 弾を dt 秒進めて当たり判定する。消えるなら true */
  private advance(b: Bullet, targets: readonly T[], dt: number): boolean {
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.vy -= this.spec.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.traveled += Math.hypot(b.vx, b.vy, b.vz) * dt;

    let best = 2;
    let bestTarget: T | null = null;
    for (const t of targets) {
      if (!t.active) continue;
      const c = t.position;
      const s = segmentSphere(
        b.px,
        b.py,
        b.pz,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z,
        t.hitRadius * this.hitRadiusScale,
      );
      if (s >= 0 && s < best) {
        best = s;
        bestTarget = t;
      }
    }
    if (bestTarget) {
      this.report(bestTarget, b, best);
      return true;
    }
    if (this.groundHeight) {
      const g = this.groundHeight(b.x, b.z);
      if (b.y <= g) {
        // 線分のうち地表の高さを下回った位置（地形は線形とみなす）
        const g0 = this.groundHeight(b.px, b.pz);
        const above = b.py - g0;
        const s = above > 0 ? above / (above - (b.y - g)) : 0;
        this.report(null, b, s);
        return true;
      }
    }
    return b.traveled >= this.spec.range;
  }

  private report(target: T | null, b: Bullet, s: number): void {
    const h = this.hit;
    h.target = target;
    h.x = b.px + (b.x - b.px) * s;
    h.y = b.py + (b.y - b.py) * s;
    h.z = b.pz + (b.z - b.pz) * s;
    if (target) this.hitCount++;
    this.onHit(h);
  }
}

function newBullet(): Bullet {
  return { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, traveled: 0 };
}

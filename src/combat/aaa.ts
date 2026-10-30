// 対空砲の射撃（2-6。Three.js 非依存）: 射程内（600〜2500m）の自機を予測射撃する。
// 範囲に入ってから warnSeconds 後に最初のバースト、以後 burstInterval ごと。撃つ前の warnSeconds は警告（HUD の AAA）。
// 1 発ごとに難易度の命中率で「予測位置へ正確に」か「予測位置から外す」を決め、弾は重力で落ちながら飛ぶ
import { AAA_CONFIG } from '../data/ground-targets';
import type { GroundTarget } from '../entities/ground-target';
import { vec3, type Vec3 } from '../flight/math';
import { segmentSphere } from './collision';
import type { Bullet, GroundHeightFn, Rng } from './gun';
import { leadPoint } from './lead';
import { Pool } from './pool';
import type { CombatTarget } from './target';

export type AaaConfig = typeof AAA_CONFIG;

/** 撃たれる側（自機） */
export type AaaTarget = Pick<CombatTarget, 'position' | 'velocity' | 'hitRadius' | 'active'>;

/** 命中の位置（使い回すので保持しないこと） */
export interface AaaHit {
  x: number;
  y: number;
  z: number;
}

/** 砲口の高さ（足元から。砲身の根元） */
const MUZZLE_HEIGHT = 4.6;

export class AntiAirFire {
  readonly shells: Pool<Bullet>;
  /** いずれかの対空砲が warnSeconds 以内に撃つ（HUD の AAA 警告） */
  warning = false;
  /** 撃った弾の数（テスト・統計用） */
  shotCount = 0;
  private readonly muzzle = vec3();
  private readonly aim = vec3();
  private readonly hit: AaaHit = { x: 0, y: 0, z: 0 };
  /** 自機の加速度の見積もり（速度の変化をなめらかにしたもの。旋回・降下中の予測に使う） */
  readonly targetAccel = vec3();
  private readonly prevVelocity = vec3();
  private hasPrevVelocity = false;

  constructor(
    private readonly onHit: (hit: Readonly<AaaHit>) => void = () => undefined,
    private readonly groundHeight: GroundHeightFn | null = null,
    private readonly rng: Rng = Math.random,
    readonly config: AaaConfig = AAA_CONFIG,
  ) {
    this.shells = new Pool(config.maxShells, newShell);
  }

  reset(): void {
    this.shells.clear();
    this.warning = false;
    this.hasPrevVelocity = false;
    this.targetAccel.x = this.targetAccel.y = this.targetAccel.z = 0;
  }

  /** 固定ステップ 1 回分。飛んでいる弾を進めてから、各対空砲の照準・射撃を進める */
  step(sites: readonly GroundTarget[], target: AaaTarget | null, dt: number): void {
    const pool = this.shells;
    for (let i = pool.count - 1; i >= 0; i--) {
      if (this.advance(pool.get(i), target, dt)) pool.release(i);
    }
    this.estimateAccel(target, dt);
    let warning = false;
    for (const s of sites) {
      if (s.type !== 'aaa') continue;
      if (this.stepSite(s, target, dt)) warning = true;
    }
    this.warning = warning;
  }

  /** 自機の加速度 = 速度の変化 ÷ dt を時定数 accelSmoothing でなめらかにし、accelLimit で頭打ちにする */
  private estimateAccel(target: AaaTarget | null, dt: number): void {
    const a = this.targetAccel;
    if (!target?.active) {
      this.hasPrevVelocity = false;
      a.x = a.y = a.z = 0;
      return;
    }
    const v = target.velocity;
    const p = this.prevVelocity;
    if (this.hasPrevVelocity && dt > 0) {
      const k = Math.min(1, dt / this.config.accelSmoothing);
      a.x += ((v.x - p.x) / dt - a.x) * k;
      a.y += ((v.y - p.y) / dt - a.y) * k;
      a.z += ((v.z - p.z) / dt - a.z) * k;
      const len = Math.hypot(a.x, a.y, a.z);
      const max = this.config.accelLimit;
      if (len > max) {
        a.x *= max / len;
        a.y *= max / len;
        a.z *= max / len;
      }
    }
    p.x = v.x;
    p.y = v.y;
    p.z = v.z;
    this.hasPrevVelocity = true;
  }

  /** 1 門分。警告を出す状態なら true */
  private stepSite(site: GroundTarget, target: AaaTarget | null, dt: number): boolean {
    const g = site.gun;
    const c = this.config;
    const m = this.muzzleOf(site);
    if (!target || !site.active || !target.active || !this.inRange(m, target)) {
      g.tracking = false;
      g.burstLeft = 0;
      // 次に範囲に入ったら warnSeconds 後に撃つ（それより早くは撃たない）
      g.timer = Math.max(g.timer - dt, c.warnSeconds);
      return false;
    }
    if (!g.tracking) {
      g.tracking = true;
      g.timer = Math.max(g.timer, c.warnSeconds);
    }
    // 砲身は予測位置（届かなければ自機）へ向ける
    const t = ballisticLead(
      this.aim,
      m,
      c.shellSpeed,
      target.position,
      target.velocity,
      this.targetAccel,
      c.gravity,
    );
    const a = t >= 0 ? this.aim : target.position;
    const dx = a.x - m.x;
    const dy = a.y - m.y;
    const dz = a.z - m.z;
    g.yaw = Math.atan2(dx, -dz);
    g.pitch = Math.atan2(dy, Math.hypot(dx, dz));

    g.timer -= dt;
    if (g.timer <= 1e-9 && g.burstLeft === 0) {
      g.burstLeft = c.burstShots;
      g.shotTimer = 0;
      g.timer += c.burstInterval;
    }
    if (g.burstLeft > 0) {
      g.shotTimer -= dt;
      while (g.shotTimer <= 1e-9 && g.burstLeft > 0) {
        this.fire(site, m, target, t >= 0);
        g.burstLeft--;
        g.shotTimer += c.shotSpacing;
      }
    }
    return g.timer <= c.warnSeconds + 1e-9;
  }

  private inRange(m: Readonly<Vec3>, target: AaaTarget): boolean {
    const p = target.position;
    const d = Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z);
    return d >= this.config.minRange && d <= this.config.maxRange;
  }

  private muzzleOf(site: GroundTarget): Vec3 {
    const m = this.muzzle;
    m.x = site.base.x;
    m.y = site.base.y + MUZZLE_HEIGHT;
    m.z = site.base.z;
    return m;
  }

  /** 1 発撃つ。命中率に外れたら、予測位置から視線に垂直な向きへ missMin〜missMax ずらした点を狙う */
  private fire(site: GroundTarget, m: Readonly<Vec3>, target: AaaTarget, hasLead: boolean): void {
    const b = this.shells.acquire();
    if (!b) return;
    const c = this.config;
    const a = this.aim;
    if (!hasLead) {
      a.x = target.position.x;
      a.y = target.position.y;
      a.z = target.position.z;
    }
    let dx = a.x - m.x;
    let dy = a.y - m.y;
    let dz = a.z - m.z;
    const hit = this.rng() < c.hitChance[site.difficulty];
    if (!hit) {
      const len = Math.hypot(dx, dy, dz);
      // 視線に垂直な 2 軸（水平の右と、それと視線に垂直な上）の円周上のランダムな向き
      let rx = -dz;
      let rz = dx;
      const rl = Math.hypot(rx, rz);
      if (rl < 1e-6) {
        // 真上を狙うとき
        rx = 1;
        rz = 0;
      } else {
        rx /= rl;
        rz /= rl;
      }
      const ux = (dy * rz) / len;
      const uy = (dz * rx - dx * rz) / len;
      const uz = (-dy * rx) / len;
      const ang = this.rng() * Math.PI * 2;
      const miss = c.missMin + this.rng() * (c.missMax - c.missMin);
      const cos = Math.cos(ang) * miss;
      const sin = Math.sin(ang) * miss;
      dx += rx * cos + ux * sin;
      dy += uy * sin;
      dz += rz * cos + uz * sin;
    }
    const len = Math.hypot(dx, dy, dz);
    b.x = b.px = m.x;
    b.y = b.py = m.y;
    b.z = b.pz = m.z;
    b.vx = (dx / len) * c.shellSpeed;
    b.vy = (dy / len) * c.shellSpeed;
    b.vz = (dz / len) * c.shellSpeed;
    b.traveled = 0;
    this.shotCount++;
  }

  /** 弾を dt 秒進める。自機・地面に当たる・射程を超えたら true */
  private advance(b: Bullet, target: AaaTarget | null, dt: number): boolean {
    const c = this.config;
    b.px = b.x;
    b.py = b.y;
    b.pz = b.z;
    b.vy -= c.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.traveled += Math.hypot(b.vx, b.vy, b.vz) * dt;
    if (target?.active) {
      const p = target.position;
      const s = segmentSphere(b.px, b.py, b.pz, b.x, b.y, b.z, p.x, p.y, p.z, target.hitRadius);
      if (s >= 0) {
        const h = this.hit;
        h.x = b.px + (b.x - b.px) * s;
        h.y = b.py + (b.y - b.py) * s;
        h.z = b.pz + (b.z - b.pz) * s;
        this.onHit(h);
        return true;
      }
    }
    if (this.groundHeight && b.y <= this.groundHeight(b.x, b.z)) return true;
    return b.traveled >= c.range;
  }
}

/**
 * 重力 gravity で落ちる弾（速さ speed で撃つ）が、加速度 accel で動く対象に当たる時間 t と、狙う点
 * （対象の t 秒後の位置 + 弾の落下分 g t² / 2）。|D + V t + (A + g ŷ) t² / 2| = s t を、
 * 重力・加速度なしの解（leadPoint）から t ← |…| / s のくり返しで詰める
 * （機銃の予測照準点の近似は t が 3 秒あると距離方向に 20m ずれる）。当たらない・10 秒を超えるなら -1
 */
export function ballisticLead(
  out: Vec3,
  from: Readonly<Vec3>,
  speed: number,
  targetPos: Readonly<Vec3>,
  targetVel: Readonly<Vec3>,
  targetAccel: Readonly<Vec3>,
  gravity: number,
): number {
  let t = leadPoint(out, from, speed, targetPos, targetVel, 0, 10);
  if (t < 0) return -1;
  const ax = targetAccel.x / 2;
  const ay = (targetAccel.y + gravity) / 2;
  const az = targetAccel.z / 2;
  for (let i = 0; i < 8; i++) {
    const x = targetPos.x + targetVel.x * t + ax * t * t - from.x;
    const y = targetPos.y + targetVel.y * t + ay * t * t - from.y;
    const z = targetPos.z + targetVel.z * t + az * t * t - from.z;
    t = Math.hypot(x, y, z) / speed;
  }
  if (!(t <= 10)) return -1;
  out.x = targetPos.x + targetVel.x * t + ax * t * t;
  out.y = targetPos.y + targetVel.y * t + ay * t * t;
  out.z = targetPos.z + targetVel.z * t + az * t * t;
  return t;
}

function newShell(): Bullet {
  return { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, traveled: 0 };
}

// 誘導ミサイル（Three.js 非依存）: 直進 → 比例航法で誘導 → 燃焼後は慣性で落下。近接信管と範囲ダメージ
import { FLARE_CONFIG, MISSILE_CONFIG, type FlareSpec, type MissileSpec } from '../data/weapons';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { rotateVec3, vec3, type Vec3 } from '../flight/math';
import { segmentSphere } from './collision';
import { findDecoy, type Flare } from './flare';
import { closestOnSegment, proportionalNavigation } from './guidance';
import type { GroundHeightFn, Rng, Shooter } from './gun';
import { Pool } from './pool';
import { teamOf } from './target';

/** ミサイルが追えるもの（対象・フレア） */
export interface HomingTarget {
  readonly position: Readonly<Vec3>;
  readonly velocity: Readonly<Vec3>;
  readonly active: boolean;
}

/** 近接信管が反応するもの。team が撃った陣営（owner）と同じなら反応しない（省略は敵側 = 1） */
export interface FuseTarget extends HomingTarget {
  readonly hitRadius: number;
  readonly team?: number;
}

export interface Missile {
  readonly position: Vec3;
  readonly prevPosition: Vec3;
  readonly velocity: Vec3;
  /** 発射からの時間（秒） */
  age: number;
  /** 追っている目標。null なら直進（ロックなしで撃った・見失った・燃焼後） */
  target: HomingTarget | null;
  /** 撃った機体の陣営。同じ陣営のフレアには釣られない */
  owner: number;
  /** 乗り換えを判定し終えたフレアの放出番号 */
  checkedBurst: number;
  /** 発射の通し番号（描画側で煙の状態をミサイルごとに持つのに使う） */
  serial: number;
}

/** 起爆の情報。オブジェクトは使い回すので保持しないこと。target は信管が反応した対象（地面なら null） */
export interface Detonation<T> {
  x: number;
  y: number;
  z: number;
  target: T | null;
  /** 撃った機体の陣営 */
  owner: number;
  /** 起爆したミサイルの発射の通し番号（PvP の表示でミサイルを見分ける。5-3） */
  serial: number;
}

const DEG = Math.PI / 180;

/** 範囲ダメージ: 爆心から対象の表面までの距離 d（m）に対するダメージ。中心ほど大きく、半径の外は 0 */
export function splashDamage(spec: MissileSpec, d: number): number {
  const r = spec.blastRadius;
  if (d >= r) return 0;
  const k = Math.max(0, d) / r;
  return spec.maxDamage * (1 - (1 - spec.edgeFraction) * k);
}

/**
 * 飛んでいるミサイルをまとめて動かす。弾数は Magazine（呼び出し側）で管理する。
 * 起爆（信管・地面）は onDetonate で知らせ、範囲ダメージは呼び出し側で splashDamage を使って与える
 */
export class MissileSystem<T extends FuseTarget> {
  readonly missiles: Pool<Missile>;
  private serial = 0;
  private side = 1;
  private readonly detonation: Detonation<T> = {
    x: 0,
    y: 0,
    z: 0,
    target: null,
    owner: 0,
    serial: 0,
  };
  private readonly dir = vec3();
  private readonly offset = vec3();
  private readonly hardpoint = vec3();
  private readonly seekerCos: number;
  private readonly maxTurn: number;

  constructor(
    readonly spec: MissileSpec = MISSILE_CONFIG,
    private readonly onDetonate: (d: Readonly<Detonation<T>>) => void = () => undefined,
    private readonly groundHeight: GroundHeightFn | null = null,
    private readonly rng: Rng = Math.random,
    /** フレアへの乗り換え（視野内のフレアまでの距離と確率） */
    private readonly decoy: Pick<FlareSpec, 'decoyRange' | 'decoyChance'> = FLARE_CONFIG,
    capacity = 8,
  ) {
    this.missiles = new Pool(capacity, newMissile);
    this.seekerCos = Math.cos(spec.seekerConeDeg * DEG);
    this.maxTurn = spec.maxTurnDeg * DEG;
  }

  /** 撃つ（弾数は見ない）。発射位置は左右のハードポイントを交互に使う。プールが満杯なら null */
  launch(shooter: Shooter, target: HomingTarget | null, owner = 0): Missile | null {
    const m = this.missiles.acquire();
    if (!m) return null;
    const q = shooter.orientation;
    const f = rotateVec3(this.dir, q, LOCAL_FORWARD);
    const h = this.spec.hardpoint;
    this.hardpoint.x = h.x * this.side;
    this.hardpoint.y = h.y;
    this.hardpoint.z = h.z;
    this.side = -this.side;
    const o = rotateVec3(this.offset, q, this.hardpoint);
    const p = shooter.position;
    m.position.x = m.prevPosition.x = p.x + o.x;
    m.position.y = m.prevPosition.y = p.y + o.y;
    m.position.z = m.prevPosition.z = p.z + o.z;
    m.velocity.x = f.x * shooter.speed;
    m.velocity.y = f.y * shooter.speed;
    m.velocity.z = f.z * shooter.speed;
    m.age = 0;
    m.target = target;
    m.owner = owner;
    m.checkedBurst = 0;
    m.serial = ++this.serial;
    return m;
  }

  step(targets: readonly T[], flares: Pool<Flare> | null, dt: number): void {
    const pool = this.missiles;
    for (let i = pool.count - 1; i >= 0; i--) {
      if (this.advance(pool.get(i), targets, flares, dt)) pool.release(i);
    }
  }

  reset(): void {
    this.missiles.clear();
    this.side = 1;
  }

  /** 次の発射の通し番号を取る（PvP の表示用のミサイルに付ける。5-3。発射の演出がこの番号の増加で拾う） */
  nextSerial(): number {
    return ++this.serial;
  }

  /** owner の撃ったミサイルだけ消す（敵を OFF にしたとき） */
  removeOwnedBy(owner: number): void {
    const pool = this.missiles;
    for (let i = pool.count - 1; i >= 0; i--) if (pool.get(i).owner === owner) pool.release(i);
  }

  /** 燃焼中か */
  isBurning(m: Readonly<Missile>): boolean {
    return m.age < this.spec.burnSeconds;
  }

  /** 1 発を dt 秒進める。消えるなら true */
  private advance(
    m: Missile,
    targets: readonly T[],
    flares: Pool<Flare> | null,
    dt: number,
  ): boolean {
    const s = this.spec;
    m.age += dt;
    if (m.age >= s.lifeSeconds) return true;
    const p = m.position;
    const v = m.velocity;
    m.prevPosition.x = p.x;
    m.prevPosition.y = p.y;
    m.prevPosition.z = p.z;

    let speed = Math.hypot(v.x, v.y, v.z);
    const dir = this.dir;
    if (speed > 0) {
      dir.x = v.x / speed;
      dir.y = v.y / speed;
      dir.z = v.z / speed;
    }
    const burning = m.age < s.burnSeconds;
    if (m.target && !m.target.active) m.target = null;
    if (burning) {
      speed = Math.min(s.maxSpeed, speed + s.thrust * dt);
      if (m.age >= s.straightSeconds) this.guide(m, dir, flares, dt);
    } else {
      // 燃焼後は誘導しない（慣性で落ちる）
      m.target = null;
      speed *= Math.exp(-s.drag * dt);
    }
    v.x = dir.x * speed;
    v.y = dir.y * speed;
    v.z = dir.z * speed;
    if (!burning) v.y -= s.gravity * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    if (m.age >= s.armSeconds && this.fuse(m, targets)) return true;
    if (this.groundHeight && p.y <= this.groundHeight(p.x, p.z)) {
      this.report(p.x, p.y, p.z, null, m);
      return true;
    }
    return false;
  }

  /** フレアへの乗り換えを判定し、目標を視野に捉えていれば比例航法で dir を回す */
  private guide(m: Missile, dir: Vec3, flares: Pool<Flare> | null, dt: number): void {
    const s = this.spec;
    if (m.target && flares) {
      const decoy = findDecoy(
        m.position,
        dir,
        m.owner,
        m.checkedBurst,
        flares,
        this.seekerCos,
        this.decoy.decoyRange,
      );
      if (decoy) {
        m.checkedBurst = decoy.burst;
        if (this.rng() < this.decoy.decoyChance) m.target = decoy;
      }
    }
    const t = m.target;
    if (!t) return;
    const d = Math.hypot(
      t.position.x - m.position.x,
      t.position.y - m.position.y,
      t.position.z - m.position.z,
    );
    const c =
      d > 0
        ? ((t.position.x - m.position.x) * dir.x +
            (t.position.y - m.position.y) * dir.y +
            (t.position.z - m.position.z) * dir.z) /
          d
        : 1;
    if (c < this.seekerCos) {
      // シーカーの視野から外れた: 見失って直進
      m.target = null;
      return;
    }
    proportionalNavigation(dir, dir, m.velocity, m.position, t, s.navConstant, this.maxTurn, dt);
  }

  /** このステップの移動の線分が、対象の半径 + fuseMargin の球にかかったら起爆。最も手前の対象。味方には反応しない */
  private fuse(m: Missile, targets: readonly T[]): boolean {
    const a = m.prevPosition;
    const b = m.position;
    let best = 2;
    let hit: T | null = null;
    for (const t of targets) {
      if (!t.active || teamOf(t) === m.owner) continue;
      const c = t.position;
      const r = t.hitRadius + this.spec.fuseMargin;
      const s = segmentSphere(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, r);
      if (s >= 0 && s < best) {
        best = s;
        hit = t;
      }
    }
    if (!hit) return false;
    // 起爆点は球にかかった位置ではなく、線分上で対象に最も近い点（爆心が対象に近いほど大きい）
    const k = closestOnSegment(a, b, hit.position);
    this.report(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k, hit, m);
    return true;
  }

  private report(x: number, y: number, z: number, target: T | null, m: Readonly<Missile>): void {
    const d = this.detonation;
    d.x = x;
    d.y = y;
    d.z = z;
    d.target = target;
    d.owner = m.owner;
    d.serial = m.serial;
    this.onDetonate(d);
  }
}

function newMissile(): Missile {
  return {
    position: vec3(),
    prevPosition: vec3(),
    velocity: vec3(),
    age: 0,
    target: null,
    owner: 0,
    checkedBurst: 0,
    serial: 0,
  };
}

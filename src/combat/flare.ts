// フレア（Three.js 非依存）: 自機の後方に放出して漂わせ、誘導中のミサイルの目標を乗り換えさせる
import { FLARE_CONFIG, type FlareSpec } from '../data/weapons';
import { LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP } from '../flight/flight-model';
import { rotateVec3, vec3, type Vec3 } from '../flight/math';
import type { Shooter } from './gun';
import { Magazine } from './magazine';
import { Pool } from './pool';

/** フレア 1 個。ミサイルの目標（HomingTarget）にもなる */
export interface Flare {
  readonly position: Vec3;
  readonly prevPosition: Vec3;
  readonly velocity: Vec3;
  age: number;
  /** 放出した機体の陣営。同じ陣営のミサイルはこのフレアに釣られない */
  owner: number;
  /** 放出の通し番号（1 から）。ミサイルは 1 回の放出につき 1 回だけ乗り換えを判定する */
  burst: number;
  /** 漂っている間 true。プールに戻ると false（ミサイルが参照していても追わなくなる） */
  active: boolean;
}

/**
 * フレアの放出（回数・クールダウン）と、漂うフレアの更新。
 * 回数とクールダウンは放出する機体ごとに Magazine を持つ。フレアの粒はこのクラスでまとめて動かす
 */
export class FlareField {
  readonly flares: Pool<Flare>;
  /** 自機の回数とクールダウン */
  readonly magazine: Magazine;
  private burstSerial = 0;
  /** 陣営ごとの放出の回数（怪獣の咆哮をフレアで防ぐ判定。6-2） */
  readonly releases = new Map<number, number>();
  private readonly forward = vec3();
  private readonly right = vec3();
  private readonly up = vec3();
  private readonly offset = vec3();

  /** dispensers: 同時に撒く機体の数（自機 + 敵機）。プールの大きさに使う */
  constructor(
    readonly spec: FlareSpec = FLARE_CONFIG,
    dispensers = 2,
  ) {
    this.magazine = new Magazine(spec.charges, spec.cooldownSeconds);
    // 1 機あたり、寿命の間にクールダウンで撒ける回数 + 1 回分
    const bursts = Math.ceil(spec.lifeSeconds / spec.cooldownSeconds) + 1;
    this.flares = new Pool(spec.perBurst * bursts * Math.max(2, dispensers), newFlare);
  }

  /** 回数が残っていてクールダウン中でなければ放出する。放出したら true */
  tryRelease(shooter: Shooter, owner = 0): boolean {
    if (!this.magazine.tryUse()) return false;
    this.release(shooter, owner);
    return true;
  }

  /** 回数を使わずに perBurst 個を放出する（敵機用・テスト用） */
  release(shooter: Shooter, owner: number): void {
    const s = this.spec;
    const q = shooter.orientation;
    const f = rotateVec3(this.forward, q, LOCAL_FORWARD);
    const r = rotateVec3(this.right, q, LOCAL_RIGHT);
    const u = rotateVec3(this.up, q, LOCAL_UP);
    const o = rotateVec3(this.offset, q, s.offset);
    const p = shooter.position;
    const burst = ++this.burstSerial;
    this.releases.set(owner, (this.releases.get(owner) ?? 0) + 1);
    for (let i = 0; i < s.perBurst; i++) {
      const fl = this.flares.acquire();
      if (!fl) return;
      // 左右に扇形に広げる（-1〜+1）。後ろ向きと下向きを混ぜる
      const side = s.perBurst > 1 ? (i / (s.perBurst - 1)) * 2 - 1 : 0;
      const ex = -f.x * 0.6 - u.x * 0.5 + r.x * side;
      const ey = -f.y * 0.6 - u.y * 0.5 + r.y * side;
      const ez = -f.z * 0.6 - u.z * 0.5 + r.z * side;
      const len = Math.hypot(ex, ey, ez);
      fl.position.x = p.x + o.x;
      fl.position.y = p.y + o.y;
      fl.position.z = p.z + o.z;
      fl.prevPosition.x = fl.position.x;
      fl.prevPosition.y = fl.position.y;
      fl.prevPosition.z = fl.position.z;
      fl.velocity.x = f.x * shooter.speed + (ex / len) * s.ejectSpeed;
      fl.velocity.y = f.y * shooter.speed + (ey / len) * s.ejectSpeed;
      fl.velocity.z = f.z * shooter.speed + (ez / len) * s.ejectSpeed;
      fl.age = 0;
      fl.owner = owner;
      fl.burst = burst;
      fl.active = true;
    }
  }

  step(dt: number): void {
    const s = this.spec;
    this.magazine.step(dt);
    const k = Math.exp(-s.drag * dt);
    const pool = this.flares;
    for (let i = pool.count - 1; i >= 0; i--) {
      const fl = pool.get(i);
      fl.age += dt;
      if (fl.age >= s.lifeSeconds) {
        fl.active = false;
        pool.release(i);
        continue;
      }
      const p = fl.position;
      const v = fl.velocity;
      fl.prevPosition.x = p.x;
      fl.prevPosition.y = p.y;
      fl.prevPosition.z = p.z;
      v.x *= k;
      v.y = v.y * k - s.gravity * dt;
      v.z *= k;
      p.x += v.x * dt;
      p.y += v.y * dt;
      p.z += v.z * dt;
    }
  }

  /** owner の撒いたフレアだけ消す（敵を OFF にしたとき） */
  removeOwnedBy(owner: number): void {
    const pool = this.flares;
    for (let i = pool.count - 1; i >= 0; i--) {
      const fl = pool.get(i);
      if (fl.owner !== owner) continue;
      fl.active = false;
      pool.release(i);
    }
  }

  /** 漂っているフレアを消し、回数を満タンに戻す */
  reset(): void {
    for (let i = 0; i < this.flares.count; i++) this.flares.get(i).active = false;
    this.flares.clear();
    this.magazine.refill();
  }
}

function newFlare(): Flare {
  return {
    position: vec3(),
    prevPosition: vec3(),
    velocity: vec3(),
    age: 0,
    owner: 0,
    burst: 0,
    active: false,
  };
}

/**
 * 乗り換えの判定に使うフレアを探す。シーカー（位置 from・向き dir の単位ベクトル）の視野
 * （cos が minCos 以上）・距離 range 以内にある、別陣営の、まだ判定していない（burst > checkedBurst）フレアのうち
 * 最も新しい放出の、視野の中心に最も近いもの。なければ null
 */
export function findDecoy(
  from: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  owner: number,
  checkedBurst: number,
  flares: Pool<Flare>,
  minCos: number,
  range: number,
): Flare | null {
  let best: Flare | null = null;
  let bestCos = -2;
  for (let i = 0; i < flares.count; i++) {
    const fl = flares.get(i);
    if (!fl.active || fl.owner === owner || fl.burst <= checkedBurst) continue;
    if (best && fl.burst < best.burst) continue;
    const dx = fl.position.x - from.x;
    const dy = fl.position.y - from.y;
    const dz = fl.position.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range || d === 0) continue;
    const c = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
    if (c < minCos) continue;
    if (!best || fl.burst > best.burst || c > bestCos) {
      best = fl;
      bestCos = c;
    }
  }
  return best;
}

// 9-6a: ネフィルガの雷球（9-6d で kaiju2-attacks.ts から分けた）: 撃ち方（扇・見越し・散らばり）と飛び方（追う・フレア・当たり）。
// Three.js 非依存
import { findDecoy, type Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { KAIJU2_CONFIG as C } from '../data/kaiju2';
import { vec3, type Vec3 } from '../flight/math';
import type { Kaiju2Orb, SkyKaiju } from '../entities/kaiju2/sky-kaiju';
import { dist } from './kaiju2-attacks';

const A = C.attacks;
const DEG = Math.PI / 180;
/** 雷球の持ち主（フレアの陣営と重ならない値） */
const ORB_OWNER = -2;
const orbDir = vec3();
const aimAt = vec3();
const orbAim = vec3();

/**
 * 雷球を撃つ: 口の前から扇に広げる。9-6d: 届くまでの秒数 × lead 先の自機の位置（見越し）へ向け、上下に交互に散らし、
 * 乱数（種から）で乱す。まっすぐ飛び続けると当たり、曲がれば外れる
 */
export function launchOrbs(
  k: SkyKaiju,
  target: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  rnd: () => number,
): number {
  const o = A.orbs;
  const n = Math.min(k.orbs.length, o.count[k.phase - 1] ?? 3);
  const dist = Math.hypot(
    target.x - k.position.x,
    target.y - k.position.y,
    target.z - k.position.z,
  );
  const t = (dist / o.speed) * o.lead;
  aimAt.x = target.x + velocity.x * t;
  aimAt.y = target.y + velocity.y * t;
  aimAt.z = target.z + velocity.z * t;
  const dir = k.directionTo(aimAt);
  const dx = dir.x;
  const dy = dir.y;
  const dz = dir.z;
  // 横の軸（水平）
  const h = Math.hypot(dx, dz) || 1;
  const sx = -dz / h;
  const sz = dx / h;
  const mouth = 70;
  let launched = 0;
  for (let i = 0; i < n; i++) {
    const orb = k.orbs[i];
    if (!orb) continue;
    const spread = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
    const side = spread * o.fanSide + (rnd() - 0.5) * o.jitter;
    const up =
      0.08 + (i % 2 === 0 ? o.fanUp : -o.fanUp) * Math.abs(spread) + (rnd() - 0.5) * o.jitter;
    orb.active = true;
    orb.age = 0;
    orb.decoyed = false;
    orb.position.x = k.position.x + k.forward.x * mouth;
    orb.position.y = k.position.y + k.forward.y * mouth;
    orb.position.z = k.position.z + k.forward.z * mouth;
    orb.prevPosition.x = orb.position.x;
    orb.prevPosition.y = orb.position.y;
    orb.prevPosition.z = orb.position.z;
    const vx = dx + sx * side;
    const vy = dy + up;
    const vz = dz + sz * side;
    const l = Math.hypot(vx, vy, vz) || 1;
    orb.velocity.x = (vx / l) * o.launchSpeed;
    orb.velocity.y = (vy / l) * o.launchSpeed;
    orb.velocity.z = (vz / l) * o.launchSpeed;
    launched++;
  }
  return launched;
}

/**
 * 雷球を 1 ステップ進める。プレイヤーに当たったら true を返す数（当たった数）。
 * フレア（2.5 秒以内の放出）が視野にあれば乗り換え、その位置へ向かう
 */
export function stepOrbs(
  k: SkyKaiju,
  target: Readonly<Vec3> | null,
  flares: Pool<Flare> | null,
  dt: number,
  velocity: Readonly<Vec3> | null = null,
): number {
  const o = A.orbs;
  const maxTurn = o.turnDegPerSec * DEG * dt;
  let hits = 0;
  for (const orb of k.orbs) {
    if (!orb.active) continue;
    orb.age += dt;
    const v = orb.velocity;
    const speed = Math.hypot(v.x, v.y, v.z) || 1;
    if (!orb.decoyed && flares) {
      orbDir.x = v.x / speed;
      orbDir.y = v.y / speed;
      orbDir.z = v.z / speed;
      const fl = findDecoy(
        orb.position,
        orbDir,
        ORB_OWNER,
        -1,
        flares,
        Math.cos(o.decoyDeg * DEG),
        o.decoyRange,
      );
      if (fl) {
        orb.decoyed = true;
        orb.decoy.x = fl.position.x;
        orb.decoy.y = fl.position.y;
        orb.decoy.z = fl.position.z;
      }
    }
    // 9-6d: 追うのも見越しの点（届くまでの秒数 × lead 先の自機）へ
    let aim: Readonly<Vec3> | null = orb.decoyed ? orb.decoy : target;
    if (!orb.decoyed && target && velocity) {
      // 届くまでの秒数は近づく速さ（雷球と自機の速度の差の、自機への向きの成分）から
      const d = dist(orb.position, target) || 1;
      const closing =
        ((v.x - velocity.x) * (target.x - orb.position.x) +
          (v.y - velocity.y) * (target.y - orb.position.y) +
          (v.z - velocity.z) * (target.z - orb.position.z)) /
        d;
      const t = Math.min(4, d / Math.max(80, closing)) * o.lead;
      orbAim.x = target.x + velocity.x * t;
      orbAim.y = target.y + velocity.y * t;
      orbAim.z = target.z + velocity.z * t;
      aim = orbAim;
    }
    const nextSpeed = Math.min(o.speed, speed + 60 * dt);
    if (aim) turnVelocity(orb, aim, maxTurn, nextSpeed);
    else scale(v, nextSpeed / speed);
    orb.position.x += v.x * dt;
    orb.position.y += v.y * dt;
    orb.position.z += v.z * dt;
    const p = orb.position;
    if (target && !orb.decoyed && dist(p, target) <= o.radius) {
      orb.active = false;
      hits++;
      continue;
    }
    if (
      orb.age >= o.lifetime ||
      p.y <= k.floorAt(p.x, p.z) ||
      (orb.decoyed && dist(p, orb.decoy) <= o.radius)
    )
      orb.active = false;
  }
  // 9-6b: 1 回の扇で当たるのは maxHits 個まで（届いたら残りを消す。Swift の HP 140 で一撃で落ちない）
  const allowed = Math.max(0, Math.min(hits, o.maxHits - k.orbVolleyHits));
  k.orbVolleyHits += allowed;
  if (k.orbVolleyHits >= o.maxHits) for (const orb of k.orbs) orb.active = false;
  return allowed;
}

function turnVelocity(orb: Kaiju2Orb, aim: Readonly<Vec3>, maxTurn: number, speed: number): void {
  const v = orb.velocity;
  const s = Math.hypot(v.x, v.y, v.z) || 1;
  const fx = v.x / s;
  const fy = v.y / s;
  const fz = v.z / s;
  let wx = aim.x - orb.position.x;
  let wy = aim.y - orb.position.y;
  let wz = aim.z - orb.position.z;
  const wl = Math.hypot(wx, wy, wz) || 1;
  wx /= wl;
  wy /= wl;
  wz /= wl;
  const angle = Math.acos(Math.max(-1, Math.min(1, fx * wx + fy * wy + fz * wz)));
  const t = angle <= maxTurn ? 1 : maxTurn / angle;
  // 角度の割合で線形に混ぜて正規化（小さな角度では回転とほぼ同じ）
  let nx = fx + (wx - fx) * t;
  let ny = fy + (wy - fy) * t;
  let nz = fz + (wz - fz) * t;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  v.x = nx * speed;
  v.y = ny * speed;
  v.z = nz * speed;
}

function scale(v: Vec3, k: number): void {
  v.x *= k;
  v.y *= k;
  v.z *= k;
}

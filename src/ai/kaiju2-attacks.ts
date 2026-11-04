// 9-6a: ネフィルガの攻撃の判定の部品（Three.js 非依存）: 攻撃の選び方・雷球の飛び方・突風 / 急降下 / 尾の当たり・
// 止まり木の場所の選び方。状態機械は kaiju2-ai.ts
import { findDecoy, type Flare } from '../combat/flare';
import type { Pool } from '../combat/pool';
import { KAIJU2_CONFIG as C, type Kaiju2Attack, type Kaiju2Part } from '../data/kaiju2';
import { vec3, type Vec3 } from '../flight/math';
import type { Kaiju2Orb, SkyKaiju } from '../entities/kaiju2/sky-kaiju';

const A = C.attacks;
const DEG = Math.PI / 180;
/** 雷球の持ち主（フレアの陣営と重ならない値） */
const ORB_OWNER = -2;
const orbDir = vec3();

/** 攻撃を選ぶのに使う、プレイヤーとの位置関係 */
export interface Kaiju2Geometry {
  /** 3D の距離 */
  readonly distance: number;
  /** 怪獣の向きとプレイヤーへの向きの角度（度。0 = 正面、180 = 真後ろ） */
  readonly angle: number;
  /** プレイヤーが怪獣より低い高さ（m。上なら負） */
  readonly drop: number;
}

export function geometryTo(k: SkyKaiju, p: Readonly<Vec3>): Kaiju2Geometry {
  const dx = p.x - k.position.x;
  const dy = p.y - k.position.y;
  const dz = p.z - k.position.z;
  const distance = Math.hypot(dx, dy, dz);
  const f = k.forward;
  const c = distance > 0 ? (dx * f.x + dy * f.y + dz * f.z) / distance : 1;
  return { distance, angle: Math.acos(Math.max(-1, Math.min(1, c))) / DEG, drop: -dy };
}

/** 壊れた部位で使えない攻撃: 翼 → 突風・急降下、頭（喉の袋）→ 雷球、尾 → 打ち払い */
export function attackUsable(
  a: Kaiju2Attack,
  broken: Readonly<Record<Kaiju2Part, boolean>>,
): boolean {
  switch (a) {
    case 'gust':
    case 'dive':
      return !broken.wingL && !broken.wingR;
    case 'orbs':
      return !broken.head;
    case 'tail':
      return !broken.tail;
  }
}

/**
 * 位置関係で使える攻撃の候補（優先の順）。後ろの近く → 尾 / 正面の近く → 突風 / 下にいる（段階 2 から）→ 急降下 / 届く → 雷球。
 * 部位の壊れ・同じ攻撃の続けすぎ（maxRepeat）は除く
 */
export function attackCandidates(
  g: Kaiju2Geometry,
  phase: number,
  broken: Readonly<Record<Kaiju2Part, boolean>>,
  history: readonly Kaiju2Attack[],
): Kaiju2Attack[] {
  const out: Kaiju2Attack[] = [];
  if (g.distance <= A.tail.pickRange && g.angle >= 180 - A.tail.pickAngleDeg) out.push('tail');
  if (g.distance <= A.gust.pickRange && g.angle <= A.gust.pickAngleDeg) out.push('gust');
  const d = A.dive;
  if (
    phase >= d.fromPhase &&
    g.drop >= d.minDrop &&
    g.distance >= d.minRange &&
    g.distance <= d.maxRange
  )
    out.push('dive');
  if (g.distance >= A.orbs.minRange && g.distance <= A.orbs.maxRange) out.push('orbs');
  return out.filter((a) => attackUsable(a, broken) && !repeated(a, history));
}

function repeated(a: Kaiju2Attack, history: readonly Kaiju2Attack[]): boolean {
  const n = C.maxRepeat;
  if (history.length < n) return false;
  for (let i = history.length - n; i < history.length; i++) if (history[i] !== a) return false;
  return true;
}

/**
 * 候補から 1 つ選ぶ: 近い間合いの攻撃（尾・突風）はそのまま、急降下と雷球が両方使えるときは乱数（種から）で半々。
 * 候補がなければ null
 */
export function pickAttack(cands: readonly Kaiju2Attack[], rnd: () => number): Kaiju2Attack | null {
  const first = cands[0];
  if (first === undefined) return null;
  if (first === 'dive' && cands.includes('orbs')) return rnd() < 0.5 ? 'dive' : 'orbs';
  return first;
}

/** 雷球を撃つ: 口の前から、プレイヤーへ向けて扇に広げる（乱数で少し散らす） */
export function launchOrbs(k: SkyKaiju, target: Readonly<Vec3>, rnd: () => number): number {
  const n = Math.min(k.orbs.length, A.orbs.count[k.phase - 1] ?? 3);
  const dir = k.directionTo(target);
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
    const o = k.orbs[i];
    if (!o) continue;
    const spread = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
    const side = spread * 0.55 + (rnd() - 0.5) * 0.1;
    const up = 0.12 + (rnd() - 0.5) * 0.08;
    o.active = true;
    o.age = 0;
    o.decoyed = false;
    o.position.x = k.position.x + k.forward.x * mouth;
    o.position.y = k.position.y + k.forward.y * mouth;
    o.position.z = k.position.z + k.forward.z * mouth;
    o.prevPosition.x = o.position.x;
    o.prevPosition.y = o.position.y;
    o.prevPosition.z = o.position.z;
    const vx = dx + sx * side;
    const vy = dy + up;
    const vz = dz + sz * side;
    const l = Math.hypot(vx, vy, vz) || 1;
    o.velocity.x = (vx / l) * A.orbs.launchSpeed;
    o.velocity.y = (vy / l) * A.orbs.launchSpeed;
    o.velocity.z = (vz / l) * A.orbs.launchSpeed;
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
    const aim = orb.decoyed ? orb.decoy : target;
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

function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 突風: 前方の円錐（長さ range・半分の角度）の中か */
export function gustHits(k: SkyKaiju, p: Readonly<Vec3>): boolean {
  const g = geometryTo(k, p);
  return g.distance <= A.gust.range && g.angle <= A.gust.halfAngleDeg;
}

/** 急降下: 体の球（hitRadius）に入ったか */
export function diveHits(k: SkyKaiju, p: Readonly<Vec3>): boolean {
  return dist(k.position, p) <= A.dive.hitRadius;
}

/** 尾の先の位置（体の後ろ reach m。振りで横へ） */
export function tailTip(k: SkyKaiju, out: Vec3): Vec3 {
  const f = k.forward;
  const h = Math.hypot(f.x, f.z) || 1;
  const swing = k.pose.tailSwing * A.tail.reach * 0.8;
  out.x = k.position.x - f.x * A.tail.reach + (-f.z / h) * swing;
  out.y = k.position.y - f.y * A.tail.reach + k.pose.tailCurl * 30;
  out.z = k.position.z - f.z * A.tail.reach + (f.x / h) * swing;
  return out;
}

/**
 * 止まり木の場所: 今の位置の周り（searchRadius）の候補（種から）のうち、陸（minGround 以上）で戦域の soft の内側の
 * 最も高い所。無ければ戦域の中心の周りで探す。どちらにも無ければ false
 */
export function choosePerch(k: SkyKaiju, rnd: () => number, out: Vec3): boolean {
  const p = C.perch;
  const tryAround = (cx: number, cz: number): boolean => {
    let best = -Infinity;
    for (let i = 0; i < p.candidates; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * p.searchRadius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (Math.hypot(x - k.center.x, z - k.center.z) > C.arena.soft) continue;
      const g = k.ground(x, z);
      if (g < p.minGround || g <= best) continue;
      best = g;
      out.x = x;
      out.y = g + p.standHeight;
      out.z = z;
    }
    return best > -Infinity;
  };
  return tryAround(k.position.x, k.position.z) || tryAround(k.center.x, k.center.z);
}

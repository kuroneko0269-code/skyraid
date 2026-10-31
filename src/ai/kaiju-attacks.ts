// 怪獣の攻撃の判定の部品（6-2。Three.js 非依存）: 攻撃の選び方、熱線の当たり（線分と点の距離）、投擲の放物線、岩。
// 状態機械は kaiju-ai.ts
import { segmentSphere } from '../combat/collision';
import { KAIJU_ATTACK_CONFIG as A, type KaijuAttack } from '../data/kaiju';
import { RAID_RULES } from '../data/raid';
import { vec3, type Vec3 } from '../flight/math';

/** 予兆の秒数（6-6: 高難度は windupCut 短く、最短 minWindup） */
export function windupSeconds(base: number, hard: boolean): number {
  const h = RAID_RULES.hard;
  return hard ? Math.max(h.minWindup, base - h.windupCut) : base;
}

/**
 * 最も近い機体の距離（水平、m）と高さ（怪獣の足元から、m）で攻撃を選ぶ。
 * - 近くて低い（薙ぎ払いの範囲）: 薙ぎ払い → 咆哮 → 熱線 → 投擲
 * - 咆哮の範囲（800m 以内・高さ 600m 未満）: 咆哮 → 熱線 → 投擲
 * - 高い（600m 以上）: 投擲 → 熱線
 * - 遠い: 熱線 → 投擲
 * usable が false の攻撃（封じられた・未開放）と、直前に maxRepeat 回続けた攻撃は選ばない。選べなければ null
 */
export function chooseAttack(
  distance: number,
  height: number,
  usable: (a: KaijuAttack) => boolean,
  history: readonly KaijuAttack[],
): KaijuAttack | null {
  const order: KaijuAttack[] = [];
  const s = A.sweep;
  if (distance <= s.pickRange && height <= s.pickAltitude)
    order.push('sweep', 'roar', 'beam', 'throw');
  else if (distance <= A.roar.pickRange && height < A.roar.immuneAltitude)
    order.push('roar', 'beam', 'throw');
  else if (height >= A.roar.immuneAltitude) order.push('throw', 'beam');
  else order.push('beam', 'throw');
  for (const a of order) {
    if (!usable(a) || !inReach(a, distance, height) || repeatedTooOften(a, history)) continue;
    return a;
  }
  return null;
}

/** その攻撃が届く距離か */
function inReach(a: KaijuAttack, distance: number, height: number): boolean {
  const d3 = Math.hypot(distance, height);
  switch (a) {
    case 'sweep':
      return distance <= A.sweep.pickRange && height <= A.sweep.pickAltitude;
    case 'roar':
      return d3 <= A.roar.radius;
    case 'beam':
      return d3 >= A.beam.pickMinRange && d3 <= A.beam.pickMaxRange;
    case 'throw':
      return d3 >= A.throw.minRange && d3 <= A.throw.maxRange;
  }
}

/** 直前に maxRepeat 回続けて使ったか（同じ攻撃を 3 回連続しない） */
export function repeatedTooOften(a: KaijuAttack, history: readonly KaijuAttack[]): boolean {
  const n = A.maxRepeat;
  if (history.length < n) return false;
  for (let i = history.length - n; i < history.length; i++) if (history[i] !== a) return false;
  return true;
}

/** 点 p から線分（始点 o・単位ベクトル d・長さ len）までの距離 */
export function distanceToRay(
  p: Readonly<Vec3>,
  o: Readonly<Vec3>,
  d: Readonly<Vec3>,
  len: number,
): number {
  const px = p.x - o.x;
  const py = p.y - o.y;
  const pz = p.z - o.z;
  const t = Math.min(len, Math.max(0, px * d.x + py * d.y + pz * d.z));
  return Math.hypot(px - d.x * t, py - d.y * t, pz - d.z * t);
}

/** 熱線の向き dir（単位）を want（単位）へ、1 ステップ maxRad まで回す（球面の線形補間） */
export function trackDirection(dir: Vec3, want: Readonly<Vec3>, maxRad: number): void {
  const dot = Math.min(1, Math.max(-1, dir.x * want.x + dir.y * want.y + dir.z * want.z));
  const angle = Math.acos(dot);
  if (angle <= maxRad || angle < 1e-6) {
    dir.x = want.x;
    dir.y = want.y;
    dir.z = want.z;
    return;
  }
  const t = maxRad / angle;
  const s = Math.sin(angle);
  const a = Math.sin((1 - t) * angle) / s;
  const b = Math.sin(t * angle) / s;
  dir.x = dir.x * a + want.x * b;
  dir.y = dir.y * a + want.y * b;
  dir.z = dir.z * a + want.z * b;
  const n = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= n;
  dir.y /= n;
  dir.z /= n;
}

/** from → to を重力 gravity で放物線に飛ばす初速（飛ぶ時間は距離 / speed を min〜max に）。飛ぶ時間を返す */
export function ballisticVelocity(out: Vec3, from: Readonly<Vec3>, to: Readonly<Vec3>): number {
  const t = A.throw;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const time = Math.min(
    t.maxFlightSeconds,
    Math.max(t.minFlightSeconds, Math.hypot(dx, dy, dz) / t.speed),
  );
  out.x = dx / time;
  out.y = dy / time + 0.5 * t.gravity * time;
  out.z = dz / time;
  return time;
}

/** 投げた岩 */
export interface Rock {
  readonly position: Vec3;
  readonly prevPosition: Vec3;
  readonly velocity: Vec3;
  active: boolean;
  age: number;
}

export function createRock(): Rock {
  return { position: vec3(), prevPosition: vec3(), velocity: vec3(), active: false, age: 0 };
}

/** 岩が当たりうるもの */
export interface RockTarget {
  readonly id: number;
  readonly position: Readonly<Vec3>;
  readonly hitRadius: number;
  readonly active: boolean;
}

/**
 * 岩を 1 ステップ動かす。当たった相手を返し（岩は消える）、地面に落ちたら 'ground'、飛んでいれば null
 */
export function stepRock(
  rock: Rock,
  targets: readonly RockTarget[],
  floor: (x: number, z: number) => number,
  dt: number,
): RockTarget | 'ground' | null {
  if (!rock.active) return null;
  const p = rock.position;
  const q = rock.prevPosition;
  q.x = p.x;
  q.y = p.y;
  q.z = p.z;
  rock.velocity.y -= A.throw.gravity * dt;
  p.x += rock.velocity.x * dt;
  p.y += rock.velocity.y * dt;
  p.z += rock.velocity.z * dt;
  rock.age += dt;
  for (const t of targets) {
    if (!t.active) continue;
    const c = t.position;
    const r = A.throw.rockRadius + t.hitRadius;
    if (segmentSphere(q.x, q.y, q.z, p.x, p.y, p.z, c.x, c.y, c.z, r) >= 0) {
      rock.active = false;
      return t;
    }
  }
  if (p.y <= floor(p.x, p.z) || rock.age > A.throw.maxFlightSeconds + 4) {
    rock.active = false;
    return 'ground';
  }
  return null;
}

/** 投擲（6-2）: 右手の岩を、投げた瞬間の to へ放物線で投げる（先読みしない）。空いている岩がなければ投げない */
export function launchRock(
  rocks: readonly Rock[],
  feet: Readonly<Vec3>,
  heading: number,
  bodyDrop: number,
  to: Readonly<Vec3>,
): void {
  const rock = rocks.find((r) => !r.active);
  if (!rock) return;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const p = rock.position;
  p.x = feet.x + fx * 30 + Math.cos(heading) * 22;
  p.y = feet.y + 95 - bodyDrop;
  p.z = feet.z + fz * 30 - Math.sin(heading) * 22;
  rock.prevPosition.x = p.x;
  rock.prevPosition.y = p.y;
  rock.prevPosition.z = p.z;
  ballisticVelocity(rock.velocity, p, to);
  rock.age = 0;
  rock.active = true;
}

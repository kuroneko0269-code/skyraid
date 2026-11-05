// 9-6a: ネフィルガの攻撃の判定の部品（Three.js 非依存）: 攻撃の選び方・雷球の飛び方・突風 / 急降下 / 尾の当たり・
// 止まり木の場所の選び方。状態機械は kaiju2-ai.ts
import { KAIJU2_CONFIG as C, type Kaiju2Attack, type Kaiju2Part } from '../data/kaiju2';
import type { Vec3 } from '../flight/math';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';

const A = C.attacks;
const DEG = Math.PI / 180;

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
  diveDue = false,
): Kaiju2Attack[] {
  const out: Kaiju2Attack[] = [];
  if (g.distance <= A.tail.pickRange && g.angle >= 180 - A.tail.pickAngleDeg) out.push('tail');
  const d = A.dive;
  // 9-6c: 急降下の出番は尾・突風の次・雷球より先（段階 2 で 1 回は見られるように）
  const dive =
    phase >= d.fromPhase &&
    g.drop >= (diveDue ? d.dueMinDrop : d.minDrop) &&
    g.distance >= (diveDue ? d.dueMinRange : d.minRange) &&
    g.distance <= d.maxRange;
  if (g.distance <= A.gust.pickRange && g.angle <= A.gust.pickAngleDeg) out.push('gust');
  if (dive) out.push('dive');
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
export function pickAttack(
  cands: readonly Kaiju2Attack[],
  rnd: () => number,
  diveDue = false,
): Kaiju2Attack | null {
  const first = cands[0];
  if (first === undefined) return null;
  if (first === 'dive' && !diveDue && cands.includes('orbs')) return rnd() < 0.5 ? 'dive' : 'orbs';
  return first;
}

export function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
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

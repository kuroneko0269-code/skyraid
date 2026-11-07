// 10-3a: 白鯨アルビオンの子分の 1 ステップ（albion-ai.ts から分けた。Three.js 非依存・決まった計算）: 巣から出す（段階・難易度の
// 間隔の倍率）・それぞれいちばん近い人を追う（10-3b: 協力は人ごと）・床と戦域の内側に保つ・体当たり（当たった子分は消える）
import { ALBION_CONFIG as C } from '../data/albion';
import type { Vec3 } from '../flight/math';
import type { AlbionHit, AlbionKaiju, AlbionTarget } from './albion-ai';
import type { Minion } from './raid-kit/minions';

/** いちばん近い、飛んでいる人（いなければ null） */
export function nearest(crowd: readonly AlbionTarget[], p: Readonly<Vec3>): AlbionTarget | null {
  let best: AlbionTarget | null = null;
  let bestD = Infinity;
  for (const c of crowd) {
    if (!c.active) continue;
    const q = c.position;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function stepAlbionMinions(
  k: AlbionKaiju,
  dt: number,
  crowd: readonly AlbionTarget[],
  onHit: AlbionHit,
): void {
  const sw = k.swarm;
  const before = sw.spawned;
  sw.step(
    dt,
    k.body,
    (part) => k.parts.isBroken(part),
    (m) => lead(nearest(crowd, m.position), m),
    k.random.next,
    k.action !== 'roar',
  );
  // 段階・難易度の間隔の倍率（出した直後に次までの秒数を縮める）
  if (sw.spawned !== before) {
    const scale = (C.phases.minionInterval[k.phaseIndex] ?? 1) * k.minionIntervalScale;
    sw.timer -= C.minions.interval * (1 - scale);
  }
  const floorPad = C.minionFloor;
  const ram = C.minionRam;
  for (const m of sw.minions) {
    if (!m.active) continue;
    keepInside(k, m, floorPad);
    if (m.age <= C.minions.dropSeconds) continue;
    for (const who of crowd) {
      if (!who.active) continue;
      const p = who.position;
      const d = Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z);
      if (d > ram.radius) continue;
      // 体当たり: 当たった子分は散って消える（撃墜に数えない）
      m.active = false;
      k.rams++;
      onHit('ram', ram.damage * k.damageScale, who);
      break;
    }
  }
}

const aim = { x: 0, y: 0, z: 0 };

/**
 * 10-3b: 子分が寄る点: 人の進む先（近づく速さで届くまでの秒数 × lead、最大 maxLead 秒）。速度が無ければ今の位置。
 * 今の位置を追うと人（巡航 250 m/s）に追いつけず、後ろを回るだけで体当たりがほとんど起きなかった（docs/kaiju-roster.md の 10-3b）
 */
function lead(t: AlbionTarget | null, m: Minion): Readonly<Vec3> | null {
  if (!t) return null;
  const p = t.position;
  const v = t.velocity;
  if (!v) return p;
  const d = Math.hypot(p.x - m.position.x, p.y - m.position.y, p.z - m.position.z);
  const s = Math.min(C.minionLead.maxSeconds, (d / C.minions.speed) * C.minionLead.scale);
  aim.x = p.x + v.x * s;
  aim.y = p.y + v.y * s;
  aim.z = p.z + v.z * s;
  return aim;
}

/** 子分を床・海面の上と戦域の中に保つ */
function keepInside(k: AlbionKaiju, m: Minion, pad: number): void {
  const floor = k.body.floorAt(m.position.x, m.position.z) + pad;
  if (m.position.y < floor) {
    m.position.y = floor;
    if (m.velocity.y < 0) m.velocity.y = 0;
  }
  const dx = m.position.x - k.body.arenaX;
  const dz = m.position.z - k.body.arenaZ;
  const r = Math.hypot(dx, dz);
  if (r > C.arena.hard) {
    m.position.x = k.body.arenaX + (dx * C.arena.hard) / r;
    m.position.z = k.body.arenaZ + (dz * C.arena.hard) / r;
  }
}

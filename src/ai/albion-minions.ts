// 10-3a: 白鯨アルビオンの子分の 1 ステップ（albion-ai.ts から分けた。Three.js 非依存・決まった計算）: 巣から出す（段階・難易度の
// 間隔の倍率）・それぞれいちばん近い人を追う（10-3b: 協力は人ごと）・床と戦域の内側に保つ・体当たり（当たった子分は消える）。
// 10-3c: 呼び声（予兆で狙う人の周りを囲み、攻撃で会う点へ一斉にまっすぐ突っ込む）
import { ALBION_CONFIG as C } from '../data/albion';
import type { Vec3 } from '../flight/math';
import type { AlbionHit, AlbionKaiju, AlbionTarget } from './albion-ai';
import { steer, type Minion } from './raid-kit/minions';

const CALL = C.attacks.call;
const DEG = Math.PI / 180;

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
  target: AlbionTarget | null = null,
): void {
  const sw = k.swarm;
  const before = sw.spawned;
  const calling = k.attack === 'call' && (k.action === 'windup' || k.action === 'active');
  if (!calling && k.callMask !== 0) {
    // 突撃した子分は通り過ぎて散る（消える。撃墜に数えない）。予兆の途中で取り消したときは残す
    if (k.attack === 'call' && k.action === 'recover') {
      sw.minions.forEach((m, i) => {
        if (m.active && isCaller(k, i)) {
          m.active = false;
          sw.expired++;
        }
      });
    }
    k.callMask = 0;
  }
  callTarget = calling ? (target?.active ? target : nearest(crowd, k.body.position)) : null;
  sw.step(
    dt,
    k.body,
    (part) => k.parts.isBroken(part),
    (m) => lead(nearest(crowd, m.position), m),
    k.random.next,
    k.action !== 'roar',
    calling ? (m, i, d) => callFlight(k, m, i, d) : undefined,
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
    const caller =
      k.attack === 'call' && k.action === 'active' && isCaller(k, sw.minions.indexOf(m));
    // 構えの間は当たらない（見てから曲がる間）
    if (caller && k.actionTime < CALL.hold) continue;
    const charging = caller;
    const radius = charging ? CALL.ramRadius : ram.radius;
    for (const who of crowd) {
      if (!who.active) continue;
      const p = who.position;
      const d = Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z);
      if (d > radius) continue;
      // 体当たり: 当たった子分は散って消える（撃墜に数えない）。突撃の当たりは「呼び声」に数える
      m.active = false;
      k.rams++;
      onHit(charging ? 'call' : 'ram', ram.damage * k.damageScale, who);
      break;
    }
  }
}

/** 呼び声の狙う人（その step の間だけ。攻撃を向ける人、いなければいちばん近い人） */
let callTarget: AlbionTarget | null = null;

function isCaller(k: AlbionKaiju, i: number): boolean {
  return i >= 0 && i < 31 && (k.callMask & (1 << i)) !== 0;
}

/** 狙う人から呼び声の範囲に飛んでいる子分の数（出たての落ちている間は数えない） */
export function countNearMinions(k: AlbionKaiju, p: Readonly<Vec3>): number {
  let n = 0;
  for (const m of k.swarm.minions) {
    if (!m.active || m.age <= C.minions.dropSeconds) continue;
    const d = Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z);
    if (d <= CALL.range) n++;
  }
  return n;
}

/** 呼び声に応える子分を決める（予兆の始め。範囲の中の飛んでいる子分） */
export function markCallers(k: AlbionKaiju, p: Readonly<Vec3>): void {
  // 並べる角度の基準: 人から見た体の向き
  k.aimAngle = Math.atan2(-(k.body.position.x - p.x), -(k.body.position.z - p.z));
  let mask = 0;
  k.swarm.minions.forEach((m, i) => {
    if (i >= 31 || !m.active || m.age <= C.minions.dropSeconds) return;
    const d = Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z);
    if (d <= CALL.range) mask |= 1 << i;
  });
  k.callMask = mask;
}

/**
 * 突撃の向き（構えの始め）: 応えた子分それぞれが、狙う人の進む先（構えの後にまっすぐ進んだら会う点。最大 maxLead 秒）へ
 * 向きを決める。構えの間は止まりかけ、その後は攻撃の終わりまでその向きのまま曲がらない
 */
export function beginCharge(k: AlbionKaiju, target: AlbionTarget): void {
  if (!target.active) {
    k.callMask = 0;
    return;
  }
  const p = target.position;
  const v = target.velocity ?? { x: 0, y: 0, z: 0 };
  const s = CALL.chargeSpeed;
  const h = CALL.hold;
  // 構えの終わりの人の位置から見越す
  ahead.x = p.x + v.x * h;
  ahead.y = p.y + v.y * h;
  ahead.z = p.z + v.z * h;
  k.swarm.minions.forEach((m, i) => {
    if (!m.active || !isCaller(k, i)) return;
    const t = intercept(m.position, ahead, v, s);
    const ax = ahead.x + v.x * t - m.position.x;
    const ay = ahead.y + v.y * t - m.position.y;
    const az = ahead.z + v.z * t - m.position.z;
    // 構えの間はその向きでほぼ止まる（速さ 1）。構えの後に突撃の速さへ
    const l = Math.hypot(ax, ay, az) || 1;
    m.velocity.x = ax / l;
    m.velocity.y = ay / l;
    m.velocity.z = az / l;
  });
}

/** 速さ s で m から出て、p から速度 v で進む人に会うまでの秒数（会えなければ maxLead） */
function intercept(m: Readonly<Vec3>, p: Readonly<Vec3>, v: Readonly<Vec3>, s: number): number {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dz = p.z - m.z;
  const a = v.x * v.x + v.y * v.y + v.z * v.z - s * s;
  const b = 2 * (dx * v.x + dy * v.y + dz * v.z);
  const c = dx * dx + dy * dy + dz * dz;
  let t: number = CALL.maxLead;
  if (Math.abs(a) < 1e-6) {
    if (b < 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      const t1 = (-b - r) / (2 * a);
      const t2 = (-b + r) / (2 * a);
      const cand = [t1, t2].filter((x) => x > 0);
      if (cand.length > 0) t = Math.min(...cand);
    }
  }
  return Math.max(0, Math.min(CALL.maxLead, t));
}

const gather = { x: 0, y: 0, z: 0 };
const ahead = { x: 0, y: 0, z: 0 };

/** 呼び声の間の飛び方（応えた子分だけ）: 予兆は人の周りの囲む点へ速く寄る、攻撃は決めた向きにまっすぐ */
function callFlight(k: AlbionKaiju, m: Minion, i: number, dt: number): boolean {
  if (!isCaller(k, i)) return false;
  if (k.action === 'active') {
    // 構え: 突撃の向きでほぼ止まっている（beginCharge が速さ 1 にした）
    if (k.actionTime < CALL.hold) return true;
    const l = Math.hypot(m.velocity.x, m.velocity.y, m.velocity.z) || 1;
    const s = CALL.chargeSpeed / l;
    m.velocity.x *= s;
    m.velocity.y *= s;
    m.velocity.z *= s;
    return true;
  }
  const t = callTarget;
  if (!t?.active) return false;
  // 囲む点: 応えた子分を人の周りに等しい角度で並べる（上下に少し散らす）
  let n = 0;
  let order = 0;
  for (let j = 0; j < 31; j++) {
    if ((k.callMask & (1 << j)) === 0) continue;
    if (j === i) order = n;
    n++;
  }
  const a = k.aimAngle + (order / Math.max(1, n)) * Math.PI * 2;
  const p = t.position;
  gather.x = p.x - Math.sin(a) * CALL.gatherRadius - m.position.x;
  gather.y = p.y + (order % 2 === 0 ? 40 : -40) - m.position.y;
  gather.z = p.z - Math.cos(a) * CALL.gatherRadius - m.position.z;
  steer(m.velocity, gather, CALL.gatherSpeed, CALL.gatherTurnDeg * DEG * dt);
  return true;
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

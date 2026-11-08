// 10-5a: UFO ゼノリスの光線と瞬間移動の始め方（xenolith-ai.ts から分けた）: 光線の候補と重み・選び方・始め方（なぎ払いの向き）・
// 光線の口の位置・瞬間移動の移る先（狙う人の周りの輪の上。床・天井・戦域に収める）。決まった計算・Three.js 非依存
import { XENOLITH_CONFIG as C, XENOLITH_ORB_SHOT, type XenolithAttack } from '../data/xenolith';
import type { Vec3 } from '../flight/math';
import { relativeAim } from './raid-kit/frame';
import type { XenolithKaiju, XenolithTarget } from './xenolith-ai';

const SWEEP_MOUTH = { forward: 70, right: 0, up: 0 };
const ORB_MOUTH = { forward: 78, right: 0, up: 0 };
const orbOrigin = { x: 0, y: 0, z: 0 };
const orbDir = { x: 0, y: 0, z: 0 };
const CANNON_MOUTH = { forward: 0, right: 0, up: -32 };
const avoid = { x: 0, y: 0, z: 0 };
const sweepAim = { x: 0, y: 0, z: 0 };

/** 光線の口（なぎ払いは前の縁、溜め撃ちは下の砲口） */
export function beamMouth(out: Vec3, k: XenolithKaiju): Vec3 {
  return k.body.point(out, k.beam.kind === 'charged' ? CANNON_MOUTH : SWEEP_MOUTH);
}

/** 使える光線と重み（値の表示にも出す） */
export function attackWeights(
  k: XenolithKaiju,
  target: Readonly<Vec3>,
): { attack: XenolithAttack; weight: number }[] {
  const p = k.body.position;
  const d = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z);
  const R = C.attackRange;
  const out: { attack: XenolithAttack; weight: number }[] = [];
  if (d <= R.sweep) out.push({ attack: 'sweep', weight: d <= R.sweepNear ? 2 : 1 });
  if (d <= R.charged && !k.parts.disabled('charged')) out.push({ attack: 'charged', weight: 1 });
  // 同じ光線は 3 回続けない（ほかに使えるものがあるときだけ。砲口が壊れていればなぎ払いだけになる）
  const fresh = out.filter((c) => !(k.lastAttack === c.attack && k.repeat >= 2));
  return fresh.length > 0 ? fresh : out;
}

export function chooseAttack(
  k: XenolithKaiju,
  target: Readonly<Vec3>,
  rnd: () => number,
): XenolithAttack | null {
  const list = attackWeights(k, target);
  const total = list.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const c of list) {
    r -= c.weight;
    if (r <= 0) return c.attack;
  }
  return list[list.length - 1]?.attack ?? null;
}

/**
 * 光線を始める。なぎ払いは狙う人の向きを真ん中に ±halfDeg を回す（向きは乱数）。仰角は狙う人の高さへ揃える（上か下へ逃げれば外れる）。
 * 溜め撃ちはロック警告の間、狙う人を追う
 */
export function startAttack(
  k: XenolithKaiju,
  a: XenolithAttack,
  target: XenolithTarget,
  rnd: () => number,
): void {
  const beam = k.beam;
  k.attack = a;
  k.attacksUsed[a]++;
  if (a === 'charged') {
    beam.startCharged(target.id ?? 0);
    k.comboArmed = k.stage >= 3 && !k.parts.disabled('combo');
    return;
  }
  const m = k.body.point({ x: 0, y: 0, z: 0 }, SWEEP_MOUTH);
  const q = target.position;
  sweepAim.x = q.x;
  sweepAim.y = q.y + (target.velocity?.y ?? 0) * C.sweep.leadY;
  sweepAim.z = q.z;
  const aim = relativeAim(k.body, m, sweepAim);
  const s = C.sweep;
  const pitch = Math.max(s.pitchMin, Math.min(s.pitchMax, aim.pitchDeg));
  const dir = rnd() < 0.5 ? -1 : 1;
  beam.startSweep(aim.yawDeg - dir * s.halfDeg, aim.yawDeg + dir * s.halfDeg, pitch);
}

/**
 * 瞬間移動の予兆を始める: 狙う人の周りの輪の上（高さは狙う人から）。床の上・天井の下・戦域の内側に収め、狙う人に近すぎたら反対側へ
 */
export function beginWarp(k: XenolithKaiju, focus: Readonly<Vec3>, rnd: () => number): void {
  const w = k.warp;
  const b = k.body;
  // 輪の高さは狙う人からの相対で選ぶので、離す人の高さは 0 にして相対の距離で比べる
  avoid.x = focus.x;
  avoid.y = 0;
  avoid.z = focus.z;
  if (!w.begin(focus, avoid, rnd)) return;
  const d = w.destination;
  d.y += focus.y;
  const fit = (): void => {
    const dx = d.x - b.arenaX;
    const dz = d.z - b.arenaZ;
    const r = Math.hypot(dx, dz);
    if (r > C.arena.soft) {
      d.x = b.arenaX + (dx * C.arena.soft) / r;
      d.z = b.arenaZ + (dz * C.arena.soft) / r;
    }
  };
  fit();
  if (Math.hypot(d.x - focus.x, d.z - focus.z) < C.warp.keepAway) {
    d.x = 2 * focus.x - d.x;
    d.z = 2 * focus.z - d.z;
    fit();
  }
  d.y = Math.min(C.floor.ceiling, Math.max(d.y, b.floorAt(d.x, d.z) + C.floor.min));
}

/**
 * 10-5b: 光の弾をばらまく: 前の縁から狙う人の進む先（届くまでの秒 × lead だけ先）を真ん中に、spreadDeg 度ずつ開いた格子
 * （横 cols × 縦 rows。段階 3 は横が増える）。協力のホストは onOrb で写しへ知らせる（turret = 格子の番号、向きは方位と仰角）
 */
export function fireOrbs(k: XenolithKaiju, target: XenolithTarget): void {
  const O = C.orbs;
  k.body.point(orbOrigin, ORB_MOUTH);
  const q = target.position;
  const v = target.velocity;
  const d = Math.hypot(q.x - orbOrigin.x, q.y - orbOrigin.y, q.z - orbOrigin.z);
  const t = (d / XENOLITH_ORB_SHOT.speed) * O.lead;
  const ax = q.x + (v?.x ?? 0) * t - orbOrigin.x;
  const ay = q.y + (v?.y ?? 0) * t - orbOrigin.y;
  const az = q.z + (v?.z ?? 0) * t - orbOrigin.z;
  const yaw0 = Math.atan2(-ax, -az);
  const pitch = Math.atan2(ay, Math.hypot(ax, az));
  const cols = k.stage >= 3 ? O.cols3 : O.cols;
  const spread = (O.spreadDeg * Math.PI) / 180;
  let i = 0;
  for (let row = 0; row < O.rows; row++)
    for (let col = 0; col < cols; col++) {
      const yaw = yaw0 + (col - (cols - 1) / 2) * spread;
      const p = pitch + (row - (O.rows - 1) / 2) * spread;
      orbDir.x = -Math.sin(yaw) * Math.cos(p);
      orbDir.y = Math.sin(p);
      orbDir.z = -Math.cos(yaw) * Math.cos(p);
      const order = {
        turret: i++,
        weapon: 'gun' as const,
        origin: orbOrigin,
        direction: orbDir,
        targetId: target.id ?? 0,
      };
      k.orbs.fire(order);
      k.onOrb?.(order);
    }
}

/** 光の弾の口（写しが同じ所から撃つ） */
export function orbMouth(out: Vec3, k: XenolithKaiju): Vec3 {
  return k.body.point(out, ORB_MOUTH);
}

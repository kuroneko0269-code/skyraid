// 10-3b: 白鯨アルビオンのボットの共通（albion-raid-bots.ts・albion-coop-bots.ts）: 熟練が狙う順・世界の用意・始めの状態・
// 予兆が自分に向いているか（避ける判断）
import type { AlbionKaiju } from '../src/ai/albion-ai';
import { inSlam, inSpout, slamRadius } from '../src/ai/albion-attacks';
import {
  GEYSER_COUNT,
  bodyLocal,
  geyserPoint,
  inRoll,
  sonarRadius,
  sonarSeconds,
} from '../src/ai/albion-aimed';
import { ALBION_CONFIG as C } from '../src/data/albion';
import { hullPenetration, type HullHit } from '../src/ai/albion-hull';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import type { Vec3 } from '../src/flight/math';
import { attachAlbionDev, type AlbionDev } from '../src/missions/albion-dev';
import { ALBION_VARIANT } from '../src/missions/albion-mission';
import { registerRaidVariant } from '../src/missions/raid-variants';
import type { ReplayStart } from '../src/replay/types';
import { createWorld, type TestWorld } from './replay-helpers';

/** 熟練が狙う順（壊れていない最初の部位。胴は最後） */
export const ALBION_FOCUS = [
  'nestFront',
  'nestMid',
  'nestRear',
  'tail',
  'head',
  'dorsal',
  'body',
] as const;

export interface AlbionBotWorld {
  readonly w: TestWorld;
  readonly dev: AlbionDev;
}

export function createAlbionWorld(): AlbionBotWorld {
  registerRaidVariant(ALBION_VARIANT);
  const w = createWorld({ enemies: { enabled: false, difficulty: 'normal' } });
  const dev = attachAlbionDev(
    w.play,
    { hpPercent: 100, broken: [], bay: false },
    { ground: w.map.ordnanceGround, map: () => w.map.def, freeFlight: false },
  );
  return { w, dev };
}

export function albionStart(seed: number, difficulty: RaidDifficulty, weapons = 0): ReplayStart {
  return {
    mode: 'raid',
    mapId: RAID_CONFIG.mapId,
    raidDifficulty: difficulty,
    raidKaiju: ALBION_VARIANT.id,
    aircraftId: 'kestrel',
    upgrades: { engine: 0, airframe: 0, weapons, avionics: 0 },
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 10300 + seed,
    weatherId: 'clear',
  };
}

const A = C.attacks;
const gp = { x: 0, z: 0 };

/** 10-3c: 水柱のどれかに近い（水平。余裕 pad m） */
function nearGeyser(k: AlbionKaiju, p: Readonly<Vec3>, pad: number): boolean {
  for (let i = 0; i < GEYSER_COUNT; i++) {
    geyserPoint(k, i, gp);
    if (Math.hypot(p.x - gp.x, p.z - gp.z) <= A.geyser.radius + pad) return true;
  }
  return false;
}

/** 10-3c: 歌の輪がこれから ahead 秒の間に p を通りそうか（予兆の間は体の位置から始まる輪） */
function sonarComing(k: AlbionKaiju, p: Readonly<Vec3>, ahead: number): boolean {
  const s = A.sonar;
  const active = k.action === 'active';
  const ox = active ? k.sonarX : k.body.position.x;
  const oy = active ? k.sonarY : k.body.position.y;
  const oz = active ? k.sonarZ : k.body.position.z;
  if (Math.abs(p.y - oy) > s.band + 60) return false;
  const d = Math.hypot(p.x - ox, p.z - oz);
  const t = active ? k.actionTime : -(s.windup - k.actionTime);
  if (active && t >= sonarSeconds()) return false;
  return d >= sonarRadius(t) - s.width && d <= sonarRadius(t + ahead) + s.width;
}

/** 10-3c: 突撃する子分が ahead 秒の間に自分の進む先の近く（pad m）を通るか */
function chargeComing(
  k: AlbionKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  ahead: number,
  pad: number,
): boolean {
  if (k.callMask === 0) return false;
  for (let i = 0; i < k.swarm.minions.length; i++) {
    const m = k.swarm.minions[i];
    if (!m?.active || (k.callMask & (1 << i)) === 0) continue;
    if (k.action === 'windup' || k.actionTime < A.call.hold) {
      if (Math.hypot(m.position.x - me.x, m.position.y - me.y, m.position.z - me.z) < 900)
        return true;
      continue;
    }
    for (let j = 0; j <= 6; j++) {
      const t = (ahead * j) / 6;
      const dx = m.position.x + m.velocity.x * t - (me.x + v.x * t);
      const dy = m.position.y + m.velocity.y * t - (me.y + v.y * t);
      const dz = m.position.z + m.velocity.z * t - (me.z + v.z * t);
      if (Math.hypot(dx, dy, dz) < pad) return true;
    }
  }
  return false;
}

/**
 * 10-3c: 予兆・攻撃が自分に向いていたら、避ける先（out）を決めて true。潮吹き・尾・横転は体の軸から横へ（体より下へ）、
 * 水柱は進む向きから 90° 横へ（柱の間を抜ける）、歌は輪の高さから上か下へ、呼び声の突撃は進む向きから 90° 横へ急旋回
 */
export function albionDodgePoint(
  k: AlbionKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
): boolean {
  const a = k.attack;
  if (a === null || (k.action !== 'windup' && k.action !== 'active')) return false;
  const sp = Math.hypot(v.x, v.z) || 1;
  const hx = v.x / sp;
  const hz = v.z / sp;
  if (a === 'geyser') {
    let hit = false;
    for (let i = 0; i <= 4; i++) {
      const t = (1.6 * i) / 4;
      if (nearGeyser(k, { x: me.x + v.x * t, y: me.y, z: me.z + v.z * t }, 90)) hit = true;
    }
    if (!hit) return false;
    // 真ん中の柱から遠い側の横へ
    const side = (k.aimX - me.x) * -hz + (k.aimZ - me.z) * hx >= 0 ? -1 : 1;
    out.x = me.x + -hz * side * 1400;
    out.z = me.z + hx * side * 1400;
    out.y = me.y;
    return true;
  }
  if (a === 'sonar') {
    if (!sonarComing(k, me, 3)) return false;
    const oy = k.action === 'active' ? k.sonarY : k.body.position.y;
    const floor = k.body.floorAt(me.x, me.z);
    const up = me.y >= oy || oy - 260 < floor + 200;
    out.x = me.x + hx * 1400;
    out.z = me.z + hz * 1400;
    out.y = oy + (up ? 280 : -280);
    return true;
  }
  if (a === 'call') {
    if (!chargeComing(k, me, v, 1.5, 70)) return false;
    if (k.action === 'windup') return false;
    const side = k.random.state % 2 === 0 ? 1 : -1;
    out.x = me.x + -hz * side * 1400;
    out.z = me.z + hx * side * 1400;
    out.y = me.y + 150;
    return true;
  }
  if (!albionThreat(k, me, v)) return false;
  // 体の軸から横へ（背の上・真後ろ・横から外へ）、体より下へ
  const b = k.body.position;
  const fx = -Math.sin(k.body.heading);
  const fz = -Math.cos(k.body.heading);
  const side = bodyLocal(k.body, me).side >= 0 ? 1 : -1;
  out.x = me.x + -fz * side * 1400 - fx * 300;
  out.z = me.z + fx * side * 1400 - fz * 300;
  out.y = Math.max(250, b.y - 300);
  return true;
}

const hullHit: HullHit = { depth: 0, normal: { x: 0, y: 1, z: 0 }, shape: 'body' };

/** 10-3c: 体を見越す秒数（役ごと。人は体に近づきすぎないよう、進む先が体に入りそうなら外へ逃げる） */
export const HULL_LOOKAHEAD: Readonly<Record<string, number>> = {
  skilled: 1.6,
  average: 1.4,
  beginner: 1.1,
  human: 2.0,
};

/**
 * 10-3c: このまま進むと ahead 秒の間に体（余裕 pad m）へ入るなら、体の面から外へ逃げる先（out）を決めて true
 */
export function albionHullAvoid(
  k: AlbionKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  ahead: number,
  out: Vec3,
  pad = 35,
): boolean {
  const b = k.body.position;
  if (Math.hypot(me.x - b.x, me.y - b.y, me.z - b.z) > 420 + Math.hypot(v.x, v.y, v.z) * ahead)
    return false;
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 1; i <= 8; i++) {
    const t = (ahead * i) / 8;
    p.x = me.x + v.x * t;
    p.y = me.y + v.y * t;
    p.z = me.z + v.z * t;
    if (!hullPenetration(k.body, p, pad, hullHit)) continue;
    // 面に沿って横へ（進む向きから面へ向かう成分を除き、外へ少し）。真っすぐ戻ろうとすると曲がりきれない
    const n = hullHit.normal;
    const sp = Math.hypot(v.x, v.y, v.z) || 1;
    const dot = (v.x * n.x + v.y * n.y + v.z * n.z) / sp;
    let tx = v.x / sp - dot * n.x;
    let ty = v.y / sp - dot * n.y;
    let tz = v.z / sp - dot * n.z;
    const tl = Math.hypot(tx, ty, tz);
    if (tl < 0.2) {
      // 真正面: 上へ逃げる
      tx = 0;
      ty = 1;
      tz = 0;
    } else {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    }
    out.x = me.x + tx * 800 + n.x * 400;
    out.y = Math.max(k.body.floorAt(me.x, me.z) + 250, me.y + ty * 800 + n.y * 400);
    out.z = me.z + tz * 800 + n.z * 400;
    return true;
  }
  return false;
}

/** 予兆・攻撃が自分に向いているか（避ける判断）。今の位置か、ahead 秒先の位置（速度 v）が範囲に入る */
export function albionThreat(
  k: AlbionKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3> = { x: 0, y: 0, z: 0 },
  ahead = 1.2,
): boolean {
  if (k.attack === null || (k.action !== 'windup' && k.action !== 'active')) return false;
  const inside = (p: Readonly<Vec3>): boolean =>
    k.attack === 'spout'
      ? inSpout(k.body, 3, p)
      : k.attack === 'slam'
        ? inSlam(k.body, slamRadius(k) + 150, p)
        : k.attack === 'roll' && inRoll(k.body, k.rollSide, p);
  for (let i = 0; i <= 4; i++) {
    const t = (ahead * i) / 4;
    if (inside({ x: me.x + v.x * t, y: me.y + v.y * t, z: me.z + v.z * t })) return true;
  }
  return false;
}

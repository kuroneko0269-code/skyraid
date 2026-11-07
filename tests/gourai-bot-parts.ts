// 10-4b: メカ怪獣ゴウライのボットの共通（gourai-raid-bots.ts・gourai-coop-bots.ts）: 熟練が狙う順・世界の用意・始めの状態・
// 予兆が自分に向いているか（回転掃射の輪・一斉発射のミサイル）・体を見越して避ける
import type { GouraiKaiju } from '../src/ai/gourai-ai';
import { inSweepBand } from '../src/ai/gourai-attacks';
import { gouraiPenetration } from '../src/ai/gourai-hull';
import type { HullHit } from '../src/ai/albion-hull';
import { GOURAI_CONFIG as C } from '../src/data/gourai';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import type { Vec3 } from '../src/flight/math';
import { attachGouraiDev, missilesOn, type GouraiDev } from '../src/missions/gourai-dev';
import { GOURAI_VARIANT } from '../src/missions/gourai-mission';
import { registerRaidVariant } from '../src/missions/raid-variants';
import type { ReplayStart } from '../src/replay/types';
import { createWorld, type TestWorld } from './replay-helpers';

/**
 * 熟練が狙う順（壊れていない最初の部位）: 横の腰の機銃 → 肩の機銃 → 背のミサイル → 排気口 → 胴。核は開いている間（放熱）はいつも先に
 */
export const GOURAI_FOCUS = ['hull'] as const;

export interface GouraiBotWorld {
  readonly w: TestWorld;
  readonly dev: GouraiDev;
}

export function createGouraiWorld(): GouraiBotWorld {
  registerRaidVariant(GOURAI_VARIANT);
  const w = createWorld({ enemies: { enabled: false, difficulty: 'normal' } });
  const dev = attachGouraiDev(
    w.play,
    { hpPercent: 100, broken: [], bay: false },
    { ground: w.map.ordnanceGround, map: () => w.map.def, freeFlight: false },
  );
  return { w, dev };
}

export function gouraiStart(seed: number, difficulty: RaidDifficulty, weapons = 0): ReplayStart {
  return {
    mode: 'raid',
    mapId: RAID_CONFIG.mapId,
    raidDifficulty: difficulty,
    raidKaiju: GOURAI_VARIANT.id,
    aircraftId: 'kestrel',
    upgrades: { engine: 0, airframe: 0, weapons, avionics: 0 },
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 10400 + seed,
    weatherId: 'clear',
  };
}

/** 回転掃射の輪がこれから当たりそうか（予兆・攻撃の間。今か ahead 秒先の位置が輪の高さ・射程の内） */
export function sweepThreat(
  k: GouraiKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  ahead = 1.2,
): boolean {
  if (k.attack !== 'sweep' || (k.action !== 'windup' && k.action !== 'active')) return false;
  const b = k.body.position;
  for (let i = 0; i <= 4; i++) {
    const t = (ahead * i) / 4;
    const p = { x: me.x + v.x * t, y: me.y + v.y * t, z: me.z + v.z * t };
    if (Math.hypot(p.x - b.x, p.z - b.z) > C.attacks.sweep.range + 150) continue;
    if (inSweepBand(k.body, p, k.sweepPitch)) return true;
  }
  return false;
}

/** 回転掃射を避ける先: 進む向きのまま、輪の高さから上か下へ 250m（床に近ければ上へ） */
export function sweepDodgePoint(
  k: GouraiKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
): void {
  const b = k.body.position;
  const h = Math.hypot(me.x - b.x, me.z - b.z);
  const band =
    b.y +
    (C.attacks.sweep.bandLow + C.attacks.sweep.bandHigh) / 2 +
    h * Math.tan((k.sweepPitch * Math.PI) / 180);
  const floor = k.body.floorAt(me.x, me.z);
  const up = me.y >= band || band - 250 < floor + 150;
  const sp = Math.hypot(v.x, v.z) || 1;
  out.x = me.x + (v.x / sp) * 1400;
  out.z = me.z + (v.z / sp) * 1400;
  out.y = band + (up ? 250 : -250);
}

/** 自分を追ってくるミサイルが range m 以内にあるか（フレアを撒く判断） */
export function missileNear(k: GouraiKaiju, id: number, me: Readonly<Vec3>, range = 700): boolean {
  return missilesOn(k, id, me, range) > 0;
}

/** 体を見越す秒数（役ごと。アルビオンと同じ） */
export const GOURAI_HULL_LOOKAHEAD: Readonly<Record<string, number>> = {
  skilled: 1.6,
  average: 1.4,
  beginner: 1.1,
  human: 2.0,
};

const hullHit: HullHit = { depth: 0, normal: { x: 0, y: 1, z: 0 }, shape: 'body' };

/** このまま進むと ahead 秒の間に体（余裕 pad m）へ入るなら、体の面から外へ逃げる先（out）を決めて true */
export function gouraiHullAvoid(
  k: GouraiKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  ahead: number,
  out: Vec3,
  pad = 30,
): boolean {
  const b = k.body.position;
  if (Math.hypot(me.x - b.x, me.y - b.y, me.z - b.z) > 150 + Math.hypot(v.x, v.y, v.z) * ahead)
    return false;
  const armored = k.phase === 1;
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 1; i <= 8; i++) {
    const t = (ahead * i) / 8;
    p.x = me.x + v.x * t;
    p.y = me.y + v.y * t;
    p.z = me.z + v.z * t;
    if (!gouraiPenetration(k.body, armored, p, pad, hullHit)) continue;
    // 体の上を越える（低く浮く箱なので上が開いている）。横の面なら横へも逃げる
    const n = hullHit.normal;
    const sp = Math.hypot(v.x, v.z) || 1;
    out.x = me.x + (v.x / sp) * 600 + n.x * 400;
    out.z = me.z + (v.z / sp) * 600 + n.z * 400;
    out.y = Math.max(b.y + 250, me.y + 200);
    return true;
  }
  return false;
}

/**
 * 回り込み: 正面（体の向きから左右 frontDeg 以内）・range m 以内にいて、核が開いていなければ、同じ側の斜め後ろ（rearDeg）の
 * 半径 radius m・体の上 up m の点へ向かう（人は厚い正面を避けて薄い横・後ろへ回る）。回り込む先を out に入れて true
 */
export function flankPoint(
  k: GouraiKaiju,
  me: Readonly<Vec3>,
  out: Vec3,
  frontDeg = 70,
  range = 2600,
  rearDeg = 135,
  radius = 750,
  up = 120,
): boolean {
  if (k.coreOpen && k.phase === 1) return false;
  const b = k.body.position;
  const dx = me.x - b.x;
  const dz = me.z - b.z;
  if (Math.hypot(dx, dz) > range) return false;
  let yaw = Math.atan2(-dx, -dz) - k.body.heading;
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  if (Math.abs(yaw) > (frontDeg * Math.PI) / 180) return false;
  const side = yaw >= 0 ? 1 : -1;
  const a = k.body.heading + side * ((rearDeg * Math.PI) / 180);
  out.x = b.x - Math.sin(a) * radius;
  out.z = b.z - Math.cos(a) * radius;
  out.y = b.y + up;
  return true;
}

/** 追ってくるいちばん近いミサイルから、その向きに直角へ急旋回する先（out）。無ければ false */
export function missileBreakPoint(
  k: GouraiKaiju,
  id: number,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
  range = 900,
): boolean {
  let best = range;
  let mx = 0;
  let mz = 0;
  for (const s of k.shots.shots) {
    if (!s.active || s.kind !== 'missile' || s.decoyed || s.targetId !== id) continue;
    const d = Math.hypot(s.position.x - me.x, s.position.y - me.y, s.position.z - me.z);
    if (d >= best) continue;
    best = d;
    mx = me.x - s.position.x;
    mz = me.z - s.position.z;
  }
  if (best >= range) return false;
  const l = Math.hypot(mx, mz) || 1;
  // ミサイルの向きに直角（今の進む向きに近い側）
  let px = -mz / l;
  let pz = mx / l;
  if (px * v.x + pz * v.z < 0) {
    px = -px;
    pz = -pz;
  }
  out.x = me.x + px * 1400;
  out.z = me.z + pz * 1400;
  out.y = Math.max(k.body.floorAt(me.x, me.z) + 200, me.y);
  return true;
}

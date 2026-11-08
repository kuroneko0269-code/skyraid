// 10-4b: メカ怪獣ゴウライのボットの共通（gourai-raid-bots.ts・gourai-coop-bots.ts）: 熟練が狙う順・世界の用意・始めの状態・
// 予兆が自分に向いているか（回転掃射の輪・一斉発射のミサイル）・体を見越して避ける
import type { GouraiKaiju } from '../src/ai/gourai-ai';
import { inSweepBand, sweepOffset } from '../src/ai/gourai-attacks';
import { gouraiPenetration } from '../src/ai/gourai-hull';
import type { HullHit } from '../src/ai/albion-hull';
import { GOURAI_CONFIG as C, GOURAI_SHOTS } from '../src/data/gourai';
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
  if (k.attack !== 'sweep') return false;
  // 10-4c: 攻撃が終わっても、飛んでいる弾が届くまで（狙う人の距離 ÷ 弾の速さ + 0.4 秒）は危ない
  const flying =
    k.action === 'recover' && k.actionTime < k.sweepRange / GOURAI_SHOTS.gun.speed + 0.4;
  if (k.action !== 'windup' && k.action !== 'active' && !flying) return false;
  for (let i = 0; i <= 4; i++) {
    const t = (ahead * i) / 4;
    const p = { x: me.x + v.x * t, y: me.y + v.y * t, z: me.z + v.z * t };
    if (inSweepBand(k, p, 10)) return true;
  }
  return false;
}

/**
 * 回転掃射を避ける先: 進む向きのまま上か下へ。10-4c: 輪が上下 2 つになった。近い輪の外側（すき間の反対）へ SWEEP_CLEAR m 出る。
 * 床に近くて出られなければ、すき間の真ん中へ（ボットは高さを細かく合わせられないので、外へ出られるときは外へ）
 */
export function sweepDodgePoint(
  k: GouraiKaiju,
  me: Readonly<Vec3>,
  v: Readonly<Vec3>,
  out: Vec3,
): void {
  const s = C.attacks.sweep;
  const side = k.sweepSide >= 0 ? 1 : -1;
  const off = sweepOffset(k, me);
  const floor = k.body.floorAt(me.x, me.z);
  // 近い輪の外側の端（すき間の反対）から SWEEP_CLEAR m 外
  const edge = side > 0 ? s.near[0] : -s.near[0];
  const outer = edge - side * SWEEP_CLEAR;
  const gapMid = (side * (s.near[1] + s.far[0])) / 2;
  const toOuter = outer - off;
  const blocked = me.y + toOuter < floor + 160;
  const want = blocked ? gapMid - off : toOuter;
  const b = k.body.position;
  const dx = me.x - b.x;
  const dz = me.z - b.z;
  const d = Math.hypot(dx, dz) || 1;
  if (blocked || d < 350) {
    // 床に近い（すき間へ）・体に近い（弾が機銃から段へ寄る所）: 体から外へ離れて、弾の届く輪の端の外へも出る
    out.x = me.x + (dx / d) * 700;
    out.z = me.z + (dz / d) * 700;
    out.y = me.y + want;
    return;
  }
  // 先の点は近く（450m）: 上下へ早く動く（10-4b は 1,400m 先で、上下 250m を緩く上った）
  const sp = Math.hypot(v.x, v.z) || 1;
  out.x = me.x + (v.x / sp) * 450;
  out.z = me.z + (v.z / sp) * 450;
  out.y = me.y + want;
}

/** 10-4c: 回転掃射の近い輪の外へどれだけ離れるか（m） */
const SWEEP_CLEAR = 80;

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

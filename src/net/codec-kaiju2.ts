// 9-6c: 協力レイドのネフィルガの状態（Kaiju2StateMsg）の直列化。ヴォルガス（codec-kaiju.ts）とは別の欄で、怪獣なしは 1 バイト。
//   [1] 有無・見える・倒した・段階（2）・制限時間の切れ（2）/ [1] 状態（3）・攻撃（3。7 はなし）・高難度
//   [1] 壊れた部位（4）・狙う人（3。7 はなし）/ [6] 位置 x・z は 0.25m、y は 0.1m の int16 / [4] 向き（方位・仰角の int16）
//   [1] 傾き 1/100 ラジアンの int8 / [1] 速さ m/s / [1] 状態の経過 1/20 秒 / [4] 全体 HP と最大 HP の u16
//   [4] 壊せる 4 部位の HP の割合 u8 / [2] 経過 1/10 秒 / [2] 嵐に入った時刻 1/10 秒（0xffff はなし）/ [1] 吠えている残り 1/20 秒
//   [1] 雷球の数 + 1 個 10 バイト（番号・位置 0.5m の int16 × 3・速度 1.25 m/s の int8 × 3）
// 合計 30 バイト（雷球 5 個で 80 バイト）。Three.js 非依存
import { KAIJU2_PARTS } from '../data/kaiju2';
import type { ByteReader, ByteWriter } from './codec';
import { NO_TARGET } from './net-controls';
import type { Vec3 } from '../flight/math';
import { NO_ATTACK } from './protocol';

/** 雷球 1 つ（写しは届くまで速度で進める） */
export interface Kaiju2OrbMsg {
  index: number;
  position: Vec3;
  velocity: Vec3;
}

/** ネフィルガの状態（9-6c。協力レイドでネフィルガのときだけ state に入る。判定はホストだけ） */
export interface Kaiju2StateMsg {
  visible: boolean;
  dead: boolean;
  /** 段階 1〜3 */
  phase: number;
  /** 制限時間の切れ: 0 なし・1 嵐・2 全体 */
  timeUp: number;
  /** KAIJU2_STATES の番号・KAIJU2_ATTACKS の番号（NO_ATTACK はなし） */
  state: number;
  attack: number;
  hard: boolean;
  /** 壊れた部位のビット（KAIJU2_PARTS の順） */
  broken: number;
  /** 狙っている人（NO_TARGET はなし） */
  targetId: number;
  position: Vec3;
  forward: Vec3;
  bank: number;
  speed: number;
  stateTime: number;
  hp: number;
  maxHp: number;
  /** 壊せる部位の HP の割合（KAIJU2_PARTS の順。0〜1） */
  parts: number[];
  elapsed: number;
  /** 嵐（段階 3）に入った時刻（秒。null は入っていない） */
  stormAt: number | null;
  shout: number;
  orbs: Kaiju2OrbMsg[];
}

const PRESENT = 0x80;
const VISIBLE = 0x40;
const DEAD = 0x20;
const HARD = 0x40;
const NONE3 = 7;
const NO_STORM = 0xffff;
const POS_XZ = 0.25;
const POS_Y = 0.1;
const ORB_POS = 0.5;
const ORB_VEL = 1.25;

/** 雷球なしのバイト数（有無の 1 バイトを含む）と、雷球 1 つのバイト数 */
export const KAIJU2_STATE_BASE_BYTES = 30;
export const KAIJU2_ORB_BYTES = 10;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const i16 = (v: number, step: number): number => Math.round(clamp(v / step, -32767, 32767));
const i8 = (v: number, step: number): number => Math.round(clamp(v / step, -127, 127));
const u8 = (v: number, scale: number): number => Math.round(clamp(v * scale, 0, 255));
const u16 = (v: number): number => Math.round(clamp(v, 0, 65535));

export function writeKaiju2(w: ByteWriter, k: Readonly<Kaiju2StateMsg> | null): void {
  if (!k) {
    w.u8(0);
    return;
  }
  w.u8(
    PRESENT |
      (k.visible ? VISIBLE : 0) |
      (k.dead ? DEAD : 0) |
      ((k.phase & 3) << 3) |
      (k.timeUp & 3),
  );
  const attack = k.attack === NO_ATTACK ? NONE3 : k.attack & 3;
  w.u8((k.state & 7) | (attack << 3) | (k.hard ? HARD : 0));
  const target = k.targetId === NO_TARGET ? NONE3 : k.targetId & 3;
  w.u8((k.broken & 15) | (target << 4));
  w.i16(i16(k.position.x, POS_XZ)).i16(i16(k.position.y, POS_Y)).i16(i16(k.position.z, POS_XZ));
  const f = k.forward;
  w.i16(Math.round(Math.atan2(f.x, -f.z) * 10000));
  w.i16(Math.round(Math.asin(clamp(f.y, -1, 1)) * 10000));
  w.i8(i8(k.bank, 0.01)).u8(u8(k.speed, 1)).u8(u8(k.stateTime, 20));
  w.u16(u16(k.hp)).u16(u16(k.maxHp));
  for (let i = 0; i < KAIJU2_PARTS.length; i++) w.u8(u8(k.parts[i] ?? 0, 255));
  w.u16(u16(k.elapsed * 10));
  w.u16(k.stormAt === null ? NO_STORM : Math.min(NO_STORM - 1, u16(k.stormAt * 10)));
  w.u8(u8(k.shout, 20));
  w.u8(k.orbs.length);
  for (const o of k.orbs) {
    w.u8(o.index);
    w.i16(i16(o.position.x, ORB_POS)).i16(i16(o.position.y, ORB_POS));
    w.i16(i16(o.position.z, ORB_POS));
    w.i8(i8(o.velocity.x, ORB_VEL)).i8(i8(o.velocity.y, ORB_VEL)).i8(i8(o.velocity.z, ORB_VEL));
  }
}

export function readKaiju2(r: ByteReader): Kaiju2StateMsg | null {
  const head = r.u8();
  if ((head & PRESENT) === 0) return null;
  const b1 = r.u8();
  const b2 = r.u8();
  const position = { x: r.i16() * POS_XZ, y: r.i16() * POS_Y, z: r.i16() * POS_XZ };
  const az = r.i16() / 10000;
  const el = r.i16() / 10000;
  const forward = {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: -Math.cos(el) * Math.cos(az),
  };
  const bank = r.i8() * 0.01;
  const speed = r.u8();
  const stateTime = r.u8() / 20;
  const hp = r.u16();
  const maxHp = r.u16();
  const parts = KAIJU2_PARTS.map(() => r.u8() / 255);
  const elapsed = r.u16() / 10;
  const storm = r.u16();
  const shout = r.u8() / 20;
  const n = Math.min(8, r.u8());
  const orbs: Kaiju2OrbMsg[] = [];
  for (let i = 0; i < n; i++) {
    const index = r.u8();
    const p = { x: r.i16() * ORB_POS, y: r.i16() * ORB_POS, z: r.i16() * ORB_POS };
    const v = { x: r.i8() * ORB_VEL, y: r.i8() * ORB_VEL, z: r.i8() * ORB_VEL };
    orbs.push({ index, position: p, velocity: v });
  }
  const attack3 = (b1 >> 3) & 7;
  const target3 = (b2 >> 4) & 7;
  return {
    visible: (head & VISIBLE) !== 0,
    dead: (head & DEAD) !== 0,
    phase: (head >> 3) & 3,
    timeUp: head & 3,
    state: b1 & 7,
    attack: attack3 === NONE3 ? NO_ATTACK : attack3,
    hard: (b1 & HARD) !== 0,
    broken: b2 & 15,
    targetId: target3 === NONE3 ? NO_TARGET : target3,
    position,
    forward,
    bank,
    speed,
    stateTime,
    hp,
    maxHp,
    parts,
    elapsed,
    stormAt: storm === NO_STORM ? null : storm / 10,
    shout,
    orbs,
  };
}

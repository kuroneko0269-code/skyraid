// 怪獣の状態の直列化（6-2。message-codec.ts から分けた）。6-6 で 1 パケット 40 バイト以下に詰めた:
//   [1] 有無・段階（3 ビット）・フェーズ（2 ビット）・熱線の有無 / [1] 攻撃（3）・段階（2）・攻撃の対象（3）
//   [6] 足元 x・z は 0.25m、y は 0.1m の int16 / [2] 向き 1/10000 ラジアンの int16
//   [2] 攻撃の経過と長さ 1/20 秒の u8 / [1] ダウンの残り 1/10 秒 / [1] 歩数の 2 で割った余り 1/128
//   [4] 全体 HP と最大 HP の u16 / [2] 最終フェーズの残り 1/10 秒（0xffff はなし）
//   [10] 部位 HP の割合 u16 × 5 / [5] ブレイクの残り 1/20 秒 u8 × 5 / [4] 熱線の向き（方位・仰角の int16。撃っているときだけ）
// 合計 35（熱線ありで 39）バイト。怪獣なしは 1 バイト。岩は event（rock）で送る。Three.js 非依存
import { KAIJU_PARTS } from '../data/kaiju';
import type { ByteReader, ByteWriter } from './codec';
import { NO_TARGET } from './net-controls';
import { NO_ATTACK, type KaijuStateMsg } from './protocol';

const PRESENT = 0x80;
const BEAM_ON = 0x40;
const NO_FINAL = 0xffff;
const NONE3 = 7;
const POS_XZ = 0.25;
const POS_Y = 0.1;

/** 怪獣の状態の最大バイト数（有無の 1 バイトを含む） */
export const KAIJU_STATE_MAX_BYTES = 39;

function u8(v: number, scale: number): number {
  return Math.round(Math.min(255, Math.max(0, v * scale)));
}

function i16(v: number, step: number): number {
  return Math.round(Math.min(32767, Math.max(-32767, v / step)));
}

function u16(v: number): number {
  return Math.round(Math.min(65535, Math.max(0, v)));
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function writeKaiju(w: ByteWriter, k: Readonly<KaijuStateMsg> | null): void {
  if (!k) {
    w.u8(0);
    return;
  }
  w.u8(PRESENT | (k.stage & 7) | ((k.phase & 3) << 3) | (k.beam ? BEAM_ON : 0));
  const attack = k.attack === NO_ATTACK ? NONE3 : k.attack & 3;
  const target = k.targetId === NO_TARGET ? NONE3 : k.targetId & 3;
  w.u8(attack | ((k.attackStep & 3) << 3) | (target << 5));
  w.i16(i16(k.feet.x, POS_XZ)).i16(i16(k.feet.y, POS_Y)).i16(i16(k.feet.z, POS_XZ));
  w.i16(Math.round(wrap(k.heading) * 10000));
  w.u8(u8(k.attackTime, 20)).u8(u8(k.attackDuration, 20));
  w.u8(u8(k.downTimer, 10));
  const walk = ((k.walkPhase % 2) + 2) % 2;
  w.u8(Math.floor(walk * 128) & 255);
  w.u16(u16(k.hp)).u16(u16(k.maxHp));
  w.u16(k.finalRemaining === null ? NO_FINAL : Math.min(NO_FINAL - 1, u16(k.finalRemaining * 10)));
  for (let i = 0; i < KAIJU_PARTS.length; i++)
    w.u16(u16(Math.min(1, Math.max(0, k.parts[i]?.hpRatio ?? 0)) * 65535));
  for (let i = 0; i < KAIJU_PARTS.length; i++) w.u8(u8(k.parts[i]?.breakTimer ?? 0, 20));
  if (k.beam) {
    const b = k.beam;
    w.i16(Math.round(Math.atan2(b.x, b.z) * 10000));
    w.i16(Math.round(Math.asin(Math.min(1, Math.max(-1, b.y))) * 10000));
  }
}

export function readKaiju(r: ByteReader): KaijuStateMsg | null {
  const head = r.u8();
  if ((head & PRESENT) === 0) return null;
  const packed = r.u8();
  const attack3 = packed & 7;
  const target3 = (packed >> 5) & 7;
  const feet = { x: r.i16() * POS_XZ, y: r.i16() * POS_Y, z: r.i16() * POS_XZ };
  const heading = r.i16() / 10000;
  const attackTime = r.u8() / 20;
  const attackDuration = r.u8() / 20;
  const downTimer = r.u8() / 10;
  const walkPhase = r.u8() / 128;
  const hp = r.u16();
  const maxHp = r.u16();
  const fin = r.u16();
  const ratios = KAIJU_PARTS.map(() => r.u16() / 65535);
  const parts = ratios.map((hpRatio) => ({ hpRatio, breakTimer: r.u8() / 20 }));
  let beam: KaijuStateMsg['beam'] = null;
  if (head & BEAM_ON) {
    const az = r.i16() / 10000;
    const el = r.i16() / 10000;
    beam = { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: Math.cos(el) * Math.cos(az) };
  }
  return {
    stage: head & 7,
    feet,
    heading,
    attack: attack3 === NONE3 ? NO_ATTACK : attack3,
    attackStep: (packed >> 3) & 3,
    attackTime,
    attackDuration,
    downTimer,
    walkPhase,
    hp,
    maxHp,
    phase: (head >> 3) & 3,
    finalRemaining: fin === NO_FINAL ? null : fin / 10,
    parts,
    beam,
    targetId: target3 === NONE3 ? NO_TARGET : target3,
  };
}

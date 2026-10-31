// 怪獣の状態の直列化（6-2。message-codec.ts から分けた）。state の末尾に 1 バイトの有無 + 怪獣（部位 5 つ・岩 3 つまで）。
// 位置は float32、向きは 1/10000 ラジアンの int16、時間は 1/100 秒の uint16、HP は uint32。Three.js 非依存
import { KAIJU_PARTS } from '../data/kaiju';
import type { ByteReader, ByteWriter } from './codec';
import type { KaijuStateMsg } from './protocol';

const NO_FINAL = 0xffff;
const ROCK_MAX = 3;

function centi(v: number): number {
  return Math.round(Math.min(655.34, Math.max(0, v)) * 100);
}

function unitI16(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v)) * 32767);
}

export function writeKaiju(w: ByteWriter, k: Readonly<KaijuStateMsg> | null): void {
  if (!k) {
    w.u8(0);
    return;
  }
  w.u8(1).u8(k.stage);
  w.f32(k.feet.x).f32(k.feet.y).f32(k.feet.z);
  w.i16(Math.round(Math.atan2(Math.sin(k.heading), Math.cos(k.heading)) * 10000));
  w.u8(k.attack).u8(k.attackStep).u16(centi(k.attackTime)).u16(centi(k.attackDuration));
  w.u16(centi(k.downTimer)).f32(k.walkPhase);
  w.u32(Math.max(0, Math.round(k.hp)))
    .u32(Math.round(k.maxHp))
    .u8(k.phase);
  w.u16(k.finalRemaining === null ? NO_FINAL : centi(k.finalRemaining));
  for (let i = 0; i < KAIJU_PARTS.length; i++) {
    const p = k.parts[i];
    w.u16(Math.round(Math.min(1, Math.max(0, p?.hpRatio ?? 0)) * 65535)).u16(
      centi(p?.breakTimer ?? 0),
    );
  }
  if (k.beam) w.u8(1).i16(unitI16(k.beam.x)).i16(unitI16(k.beam.y)).i16(unitI16(k.beam.z));
  else w.u8(0);
  const rocks = k.rocks.slice(0, ROCK_MAX);
  w.u8(rocks.length);
  for (const r of rocks) w.f32(r.x).f32(r.y).f32(r.z);
}

export function readKaiju(r: ByteReader): KaijuStateMsg | null {
  if (r.u8() === 0) return null;
  const stage = r.u8();
  const feet = { x: r.f32(), y: r.f32(), z: r.f32() };
  const heading = r.i16() / 10000;
  const attack = r.u8();
  const attackStep = r.u8();
  const attackTime = r.u16() / 100;
  const attackDuration = r.u16() / 100;
  const downTimer = r.u16() / 100;
  const walkPhase = r.f32();
  const hp = r.u32();
  const maxHp = r.u32();
  const phase = r.u8();
  const fin = r.u16();
  const parts = KAIJU_PARTS.map(() => ({ hpRatio: r.u16() / 65535, breakTimer: r.u16() / 100 }));
  const beam = r.u8() === 1 ? { x: r.i16() / 32767, y: r.i16() / 32767, z: r.i16() / 32767 } : null;
  const n = Math.min(ROCK_MAX, r.u8());
  const rocks = Array.from({ length: n }, () => ({ x: r.f32(), y: r.f32(), z: r.f32() }));
  return {
    stage,
    feet,
    heading,
    attack,
    attackStep,
    attackTime,
    attackDuration,
    downTimer,
    walkPhase,
    hp,
    maxHp,
    phase,
    finalRemaining: fin === NO_FINAL ? null : fin / 100,
    parts,
    beam,
    rocks,
  };
}

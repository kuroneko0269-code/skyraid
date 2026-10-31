// 防衛戦（7-2）の状態の直列化（message-codec.ts から呼ぶ）:
//   [1] 有無・段階（2 ビット）/ [1] 波 / [1] 残りの敵 / [1] 準備の残り 1/10 秒（最大 25.5 秒）
//   [4] 司令部の HP と最大 HP の u16 / [1] 施設のビット / [1] 予告の方向 / [3] 予告の数（戦闘機・爆撃機・巡航ミサイル）
//   [1] スキップのビット・[1] 補給のビット / [1] 戦闘機の数 + 1 機 13 バイト（番号と機銃のビット・位置 0.5m の int16 × 3・姿勢 6）
// 戦闘機なしで 16 バイト。防衛戦でなければ 1 バイト。Three.js 非依存
import { readQuat, writeQuat, type ByteReader, type ByteWriter } from './codec';
import type { DefenseFighterMsg, DefenseStateMsg } from './protocol';

const PRESENT = 0x80;
const FIRING = 0x80;
const POS = 0.5;

function i16(v: number): number {
  return Math.round(Math.min(32767, Math.max(-32767, v / POS)));
}

function u8(v: number): number {
  return Math.round(Math.min(255, Math.max(0, v)));
}

export function writeDefense(w: ByteWriter, d: Readonly<DefenseStateMsg> | null): void {
  if (!d) {
    w.u8(0);
    return;
  }
  w.u8(PRESENT | (d.phase & 3));
  w.u8(u8(d.wave))
    .u8(u8(d.remaining))
    .u8(u8(d.intermission * 10));
  w.u16(Math.round(Math.min(65535, Math.max(0, Math.ceil(d.hqHp)))));
  w.u16(Math.round(Math.min(65535, Math.max(0, d.hqMaxHp))));
  w.u8(d.aliveBits & 0xff).u8(u8(d.approach));
  w.u8(u8(d.fighters)).u8(u8(d.bombers)).u8(u8(d.cruise));
  w.u8(d.skipMask & 0xff).u8(d.supplyMask & 0xff);
  w.u8(d.enemies.length);
  for (const e of d.enemies) {
    w.u8((e.index & 0x7f) | (e.firing ? FIRING : 0));
    w.i16(i16(e.position.x)).i16(i16(e.position.y)).i16(i16(e.position.z));
    writeQuat(w, e.orientation);
  }
}

export function readDefense(r: ByteReader): DefenseStateMsg | null {
  const head = r.u8();
  if ((head & PRESENT) === 0) return null;
  const wave = r.u8();
  const remaining = r.u8();
  const intermission = r.u8() / 10;
  const hqHp = r.u16();
  const hqMaxHp = r.u16();
  const aliveBits = r.u8();
  const approach = r.u8();
  const fighters = r.u8();
  const bombers = r.u8();
  const cruise = r.u8();
  const skipMask = r.u8();
  const supplyMask = r.u8();
  const n = r.u8();
  const enemies: DefenseFighterMsg[] = [];
  for (let i = 0; i < n; i++) {
    const b = r.u8();
    const position = { x: r.i16() * POS, y: r.i16() * POS, z: r.i16() * POS };
    const orientation = readQuat(r, { x: 0, y: 0, z: 0, w: 1 });
    enemies.push({ index: b & 0x7f, firing: (b & FIRING) !== 0, position, orientation });
  }
  return {
    phase: head & 3,
    wave,
    remaining,
    intermission,
    hqHp,
    hqMaxHp,
    aliveBits,
    approach,
    fighters,
    bombers,
    cruise,
    skipMask,
    supplyMask,
    enemies,
  };
}

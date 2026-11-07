// 10-2: 協力レイドの怪獣ごとの差し込み口（net/raid-plugin.ts）の直列化: state の末尾の欄（有無 1 バイト。有りは怪獣の番号 +
// 長さ u16 + 中身）と、できごとのメッセージ kx（怪獣の番号・tick・長さ u16 + 中身）。中身の形は怪獣ごと（raid-kit-codec.ts）。
// Three.js 非依存
import type { ByteReader, ByteWriter } from './codec';
import type { RaidEventMsg, RaidExtraMsg, StateMsg } from './protocol';

/** 中身の上限（バイト。長さが u16） */
const EXTRA_MAX = 0xffff;

export function writeExtra(w: ByteWriter, e: RaidExtraMsg | undefined): void {
  if (!e) {
    w.u8(0);
    return;
  }
  w.u8(1).u8(e.kaiju);
  writeBytes(w, e.bytes);
}

/** state の末尾の欄を読んで msg に足す（無ければそのまま） */
export function readExtra(r: ByteReader, msg: StateMsg): StateMsg {
  if (r.u8() === 0) return msg;
  const kaiju = r.u8();
  return { ...msg, raidExtra: { kaiju, bytes: readBytes(r) } };
}

export function writeRaidEvent(w: ByteWriter, msg: RaidEventMsg): void {
  w.u8(msg.kaiju).u32(msg.tick);
  writeBytes(w, msg.bytes);
}

export function readRaidEvent(r: ByteReader): RaidEventMsg {
  const kaiju = r.u8();
  const tick = r.u32();
  return { type: 'kx', kaiju, tick, bytes: readBytes(r) };
}

function writeBytes(w: ByteWriter, b: Uint8Array): void {
  const n = Math.min(EXTRA_MAX, b.length);
  w.u16(n);
  for (let i = 0; i < n; i++) w.u8(b[i] ?? 0);
}

function readBytes(r: ByteReader): Uint8Array {
  const n = r.u16();
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = r.u8();
  return out;
}

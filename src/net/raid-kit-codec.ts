// 10-2: 共通の部品（src/ai/raid-kit/）の協力の直列化（差し込み口 net/raid-plugin.ts の state・できごとの中身に使う）。
// 通信を重くしない工夫（docs/kaiju-roster.md の「協力の同期」）:
// - 部位: 全体の HP（u16 の割合）・壊れたビット（u16）・壊せる部位の HP の割合（u8 ずつ）。部位 8 つで 12 バイト
// - 子分: 飛んでいるものだけ、怪獣の位置からの相対の位置（0.5m の int16 × 3）と向き（方位・仰角の int8）。1 匹 9 バイト
//   （上限 12 匹で 109 バイト）。写しは届くまで向きと速さで進める。state 2 回に 1 回だけ送ってもよい（怪獣のタスクで決める）
// - 弾: 位置を毎回送らない。撃った瞬間だけ「砲台・向き」をできごとで送り（1 発 4 バイト）、写しは同じ式でまっすぐ飛ばす
//   （ミサイルは写しでも狙う人を追う。当たりはホストだけが決め、当たったら HP の event が来る）
// Three.js 非依存
import { ByteReader, ByteWriter } from './codec';
import type { PartSet } from '../ai/raid-kit/parts';
import type { MinionSwarm } from '../ai/raid-kit/minions';
import type { ShotOrder } from '../ai/raid-kit/barrage';
import type { Vec3 } from '../flight/math';

const POS = 0.5;
const ANG = 180 / 127;

const i16 = (v: number): number => Math.round(Math.max(-32767, Math.min(32767, v)));
const i8 = (v: number): number => Math.round(Math.max(-127, Math.min(127, v)));

/** 部位の写し（HP の割合と壊れたビット） */
export interface PartsView {
  ratio: number;
  broken: number;
  parts: number[];
}

export function writeParts(w: ByteWriter, p: PartSet): void {
  w.u16(Math.round(p.ratio * 65535)).u16(p.brokenMask & 0xffff);
  w.u8(p.count);
  for (let i = 0; i < p.count; i++) w.u8(Math.round(p.partRatio(i) * 255));
}

export function readParts(r: ByteReader): PartsView {
  const ratio = r.u16() / 65535;
  const broken = r.u16();
  const n = r.u8();
  const parts: number[] = [];
  for (let i = 0; i < n; i++) parts.push(r.u8() / 255);
  return { ratio, broken, parts };
}

/** 子分 1 匹の写し */
export interface MinionView {
  id: number;
  position: Vec3;
  /** 向き（方位・仰角のラジアン。写しは速さを掛けて進める） */
  yaw: number;
  pitch: number;
}

/** 飛んでいる子分（最大 255 匹）。origin は怪獣の位置（相対で詰める） */
export function writeMinions(w: ByteWriter, s: MinionSwarm, origin: Readonly<Vec3>): void {
  const active = s.minions.filter((m) => m.active).slice(0, 255);
  w.u8(active.length);
  for (const m of active) {
    w.u8(m.id & 0xff);
    w.i16(i16((m.position.x - origin.x) / POS));
    w.i16(i16((m.position.y - origin.y) / POS));
    w.i16(i16((m.position.z - origin.z) / POS));
    const v = m.velocity;
    const yaw = Math.atan2(-v.x, -v.z);
    const pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    w.i8(i8((yaw * 180) / Math.PI / ANG)).i8(i8((pitch * 180) / Math.PI / ANG));
  }
}

export function readMinions(r: ByteReader, origin: Readonly<Vec3>): MinionView[] {
  const n = r.u8();
  const out: MinionView[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.u8();
    const x = origin.x + r.i16() * POS;
    const y = origin.y + r.i16() * POS;
    const z = origin.z + r.i16() * POS;
    const yaw = (r.i8() * ANG * Math.PI) / 180;
    const pitch = (r.i8() * ANG * Math.PI) / 180;
    out.push({ id, position: { x, y, z }, yaw, pitch });
  }
  return out;
}

/** 撃った弾の知らせ（できごとの中身）: 砲台（7 ビット）とミサイルの印・方位（1/100 度の int16）・仰角（1/2 度の int8） */
export interface ShotNote {
  turret: number;
  missile: boolean;
  /** 世界の方位（北 -z から時計回りの度）と仰角（度） */
  yawDeg: number;
  pitchDeg: number;
}

export function shotNote(o: ShotOrder): ShotNote {
  const d = o.direction;
  return {
    turret: o.turret,
    missile: o.weapon === 'missile',
    yawDeg: (Math.atan2(-d.x, -d.z) * 180) / Math.PI,
    pitchDeg: (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI,
  };
}

export const SHOT_NOTE_BYTES = 4;

export function writeShots(w: ByteWriter, shots: readonly ShotNote[]): void {
  w.u8(Math.min(255, shots.length));
  for (const s of shots.slice(0, 255)) {
    w.u8((s.turret & 0x7f) | (s.missile ? 0x80 : 0));
    w.i16(i16(s.yawDeg * 100));
    w.i8(i8(s.pitchDeg * 2));
  }
}

export function readShots(r: ByteReader): ShotNote[] {
  const n = r.u8();
  const out: ShotNote[] = [];
  for (let i = 0; i < n; i++) {
    const b = r.u8();
    out.push({
      turret: b & 0x7f,
      missile: (b & 0x80) !== 0,
      yawDeg: r.i16() / 100,
      pitchDeg: r.i8() / 2,
    });
  }
  return out;
}

/** ByteWriter の中身を Uint8Array に（差し込み口の bytes） */
export function bytesOf(w: ByteWriter): Uint8Array {
  return new Uint8Array(w.finish());
}

/** 差し込み口の bytes を読む */
export function readerOf(bytes: Uint8Array): ByteReader {
  return new ByteReader(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

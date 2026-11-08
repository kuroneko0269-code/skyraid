// 10-5b: 協力レイドの UFO ゼノリスの state とできごとの詰め方（net/xenolith-coop.ts のホスト → 写し）。
// state: 体（位置・向き・傾き・速度・回転・輪の角度・動き方）・段階・バリア（段と経過・外れる時間）・瞬間移動（段と経過・予兆の秒・移る先）・
// 光線（種類・段・経過・向き・口・狙う人）・光の弾の予兆・次の光線と瞬間移動までの秒・経過・攻撃の対象・波紋・部位（raid-kit-codec の writeParts）。
// 約 110 バイト（15Hz で 1.7KB/s）。できごと: 光の弾（扇の番号と向き。raid-kit-codec の writeShots。1 発 4 バイト）。写しは口から同じ向きに撃つ。
// Three.js 非依存
import type { BarrierPhase, WarpPhase } from '../ai/raid-kit/shield';
import type { BeamPhase } from '../ai/raid-kit/beam';
import { XENOLITH_MOVES } from '../data/xenolith';
import { XENOLITH_RAID_CONFIG as R } from '../data/xenolith-raid';
import type { XenolithRaid } from '../missions/xenolith-raid';
import { ByteWriter } from './codec';
import { bytesOf, readParts, readerOf, writeParts } from './raid-kit-codec';

const NONE = 255;
const BARRIER: readonly BarrierPhase[] = ['up', 'flicker', 'down'];
const WARP: readonly WarpPhase[] = ['idle', 'telegraph', 'cooldown'];
const BEAM: readonly BeamPhase[] = ['idle', 'warn', 'charge', 'fire', 'recover'];

const i16 = (v: number): number => Math.round(Math.max(-32767, Math.min(32767, v)));
const u16 = (v: number): number => Math.round(Math.max(0, Math.min(65535, v)));
const deg = (rad: number): number => ((((rad * 180) / Math.PI) % 360) + 360) % 360;

/** state の中身（ホスト → 写し） */
export function writeXenolithState(raid: XenolithRaid, targetId: number | null): Uint8Array {
  const k = raid.kaiju;
  const b = k.body;
  const w = new ByteWriter(200);
  const flags =
    (b.visible ? 1 : 0) |
    (raid.dead ? 2 : 0) |
    (raid.timeUp ? 4 : 0) |
    (raid.difficulty === 'hard' ? 8 : 0) |
    (b.warped ? 16 : 0);
  w.u8(flags).u8(Math.min(4, raid.players));
  w.f32(b.position.x).f32(b.position.y).f32(b.position.z).f32(b.heading);
  w.i16(Math.round(b.pitch * 10000)).i16(Math.round(b.roll * 10000));
  w.i16(i16(b.velocity.x * 50))
    .i16(i16(b.velocity.y * 50))
    .i16(i16(b.velocity.z * 50));
  w.u16(u16(deg(b.spin) * 100)).u16(u16(b.ringDeg * 100));
  w.u8(XENOLITH_MOVES.indexOf(b.move)).u16(u16(b.moveTime * 100));
  w.u8(k.stage);
  const bar = k.barrier;
  w.u8(BARRIER.indexOf(bar.phase))
    .u16(u16(bar.time * 100))
    .u16(u16(k.barrierSpec.down * 100));
  const wp = k.warp;
  w.u8(WARP.indexOf(wp.phase))
    .u16(u16(wp.time * 100))
    .u16(u16(k.warpSpec.telegraph * 100));
  w.f32(wp.destination.x).f32(wp.destination.y).f32(wp.destination.z);
  w.u8(Math.min(255, wp.warps));
  const beam = k.beam;
  w.u8(BEAM.indexOf(beam.phase))
    .u8(beam.kind === 'charged' ? 1 : 0)
    .u16(u16(beam.time * 100));
  w.i16(i16(beam.yawDeg * 100)).i16(i16(beam.pitchDeg * 100));
  w.i16(i16(beam.fromYawDeg * 100)).i16(i16(beam.toYawDeg * 100));
  w.i16(i16((beam.origin.x - b.position.x) * 10));
  w.i16(i16((beam.origin.y - b.position.y) * 10));
  w.i16(i16((beam.origin.z - b.position.z) * 10));
  w.i16(i16(beam.direction.x * 30000))
    .i16(i16(beam.direction.y * 30000))
    .i16(i16(beam.direction.z * 30000));
  w.u8(beam.targetId < 0 ? NONE : beam.targetId & 0xff);
  w.u8(k.orbPhase === 'warn' ? 1 : 0).u8(u16(Math.min(2.5, k.orbTime) * 100));
  w.u16(u16(k.cooldown * 100)).u16(u16(Math.min(600, k.warpTimer) * 100));
  w.u16(u16(Math.min(6000, raid.elapsed) * 10));
  w.u8(targetId ?? NONE);
  w.u8(k.rippleSphere < 0 ? NONE : k.rippleSphere).u8(u16(Math.min(2.5, k.rippleAge) * 100));
  writeParts(w, k.parts);
  return bytesOf(w);
}

/** state を写しに読む */
export function readXenolithState(
  bytes: Uint8Array,
  raid: XenolithRaid,
  out: { targetId: number | null },
): void {
  const r = readerOf(bytes);
  const k = raid.kaiju;
  const b = k.body;
  const flags = r.u8();
  const players = r.u8();
  const wasVisible = b.visible;
  b.visible = (flags & 1) !== 0;
  raid.dead = (flags & 2) !== 0;
  raid.timeUp = (flags & 4) !== 0;
  raid.difficulty = (flags & 8) !== 0 ? 'hard' : 'normal';
  const warped = (flags & 16) !== 0;
  raid.raid = true;
  raid.players = players;
  const x = r.f32();
  const y = r.f32();
  const z = r.f32();
  // 瞬間移動・大きくずれた・出たばかりは補間しない（前の位置も同じに）
  const jump =
    warped || !wasVisible || Math.hypot(x - b.position.x, y - b.position.y, z - b.position.z) > 80;
  b.position.x = x;
  b.position.y = y;
  b.position.z = z;
  b.heading = r.f32();
  b.pitch = r.i16() / 10000;
  b.roll = r.i16() / 10000;
  b.velocity.x = r.i16() / 50;
  b.velocity.y = r.i16() / 50;
  b.velocity.z = r.i16() / 50;
  const spin = ((r.u16() / 100) * Math.PI) / 180;
  b.ringDeg = r.u16() / 100;
  if (jump) {
    b.prevPosition.x = x;
    b.prevPosition.y = y;
    b.prevPosition.z = z;
    b.prevHeading = b.heading;
    b.prevSpin = spin;
    b.warped = true;
  }
  b.spin = spin;
  b.move = XENOLITH_MOVES[r.u8()] ?? 'cruise';
  b.moveTime = r.u16() / 100;
  k.stage = r.u8();
  const bar = k.barrier;
  bar.phase = BARRIER[r.u8()] ?? 'up';
  bar.time = r.u16() / 100;
  k.barrierSpec.down = r.u16() / 100;
  const wp = k.warp;
  wp.phase = WARP[r.u8()] ?? 'idle';
  wp.time = r.u16() / 100;
  k.warpSpec.telegraph = r.u16() / 100;
  wp.destination.x = r.f32();
  wp.destination.y = r.f32();
  wp.destination.z = r.f32();
  wp.warps = r.u8();
  const beam = k.beam;
  beam.phase = BEAM[r.u8()] ?? 'idle';
  beam.kind = r.u8() === 1 ? 'charged' : 'sweep';
  beam.time = r.u16() / 100;
  beam.yawDeg = r.i16() / 100;
  beam.pitchDeg = r.i16() / 100;
  beam.fromYawDeg = r.i16() / 100;
  beam.toYawDeg = r.i16() / 100;
  beam.origin.x = x + r.i16() / 10;
  beam.origin.y = y + r.i16() / 10;
  beam.origin.z = z + r.i16() / 10;
  beam.direction.x = r.i16() / 30000;
  beam.direction.y = r.i16() / 30000;
  beam.direction.z = r.i16() / 30000;
  const bt = r.u8();
  beam.targetId = bt === NONE ? -1 : bt;
  k.attack = beam.phase === 'idle' ? null : beam.kind;
  k.orbPhase = r.u8() === 1 ? 'warn' : 'idle';
  k.orbTime = r.u8() / 100;
  k.cooldown = r.u16() / 100;
  k.warpTimer = r.u16() / 100;
  raid.elapsed = r.u16() / 10;
  const tid = r.u8();
  out.targetId = tid === NONE ? null : tid;
  const rs = r.u8();
  k.rippleSphere = rs === NONE ? -1 : rs;
  k.rippleAge = r.u8() / 100;
  const view = readParts(r);
  const p = k.parts;
  // 体力（写しの最大 HP は 1 として割合で持つ）・部位の割合
  if (p.maxHp !== 1) p.setMaxHp(1);
  const before = p.hp;
  p.hp = view.ratio;
  if (p.hp < before) raid.flash = R.flashSeconds;
  for (let i = 0; i < p.count; i++) {
    const broken = (view.broken & (1 << i)) !== 0;
    const was = p.isBroken(i);
    p.partHp[i] = broken ? 0 : (p.partMaxHp[i] ?? 0) * Math.max(0.001, view.parts[i] ?? 1);
    if (broken && !was && !p.brokenOrder.includes(i)) p.brokenOrder.push(i);
  }
}

// 10-4b: 協力レイドのメカ怪獣ゴウライの state とできごとの詰め方（net/gourai-coop.ts のホスト → 写し）。
// state: 体（巡回・位置・向き・傾き・速度）・段・段階・熱・回転掃射の向きと傾き・経過・攻撃の対象・数え・見た目の姿勢・部位
// （raid-kit-codec の writeParts）・飛んでいるミサイル（怪獣からの相対 0.5m の int16 × 3・向きの int8 × 2・狙う人とフレアの印。1 発 10 バイト）。
// できごと: 弾幕の機銃の弾（砲台と向き。raid-kit-codec の writeShots。1 発 4 バイト）。回転掃射の弾は写しが同じ式で撃つ（送らない）。
// Three.js 非依存
import type { Shot } from '../ai/raid-kit/shots';
import { GOURAI_ACTIONS, GOURAI_ATTACKS, GOURAI_SHOTS } from '../data/gourai';
import { GOURAI_RAID_CONFIG as R } from '../data/gourai-raid';
import type { GouraiRaid } from '../missions/gourai-raid';
import { ByteWriter } from './codec';
import { bytesOf, readParts, readerOf, writeParts } from './raid-kit-codec';

const NONE = 255;
const POS = 0.5;
const ANG = Math.PI / 127;

const i16 = (v: number): number => Math.round(Math.max(-32767, Math.min(32767, v)));
const i8 = (v: number): number => Math.round(Math.max(-127, Math.min(127, v)));
const u8r = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);

/** state の中身（ホスト → 写し） */
export function writeGouraiState(raid: GouraiRaid, targetId: number | null): Uint8Array {
  const k = raid.kaiju;
  const b = k.body;
  const w = new ByteWriter(400);
  const flags =
    (b.visible ? 1 : 0) |
    (raid.dead ? 2 : 0) |
    (raid.timeUp ? 4 : 0) |
    (raid.difficulty === 'hard' ? 8 : 0);
  w.u8(flags).u8(Math.min(4, raid.players));
  w.f32(b.patrol.x).f32(b.patrol.z).f32(b.patrol.radius).u8(b.waypoint);
  w.f32(b.position.x).f32(b.position.y).f32(b.position.z).f32(b.heading);
  w.i16(Math.round(b.pitch * 10000)).i16(Math.round(b.roll * 10000));
  w.i16(i16(b.velocity.x * 100)).i16(i16(b.velocity.z * 100));
  w.u8(GOURAI_ACTIONS.indexOf(k.action));
  w.u8(k.attack ? GOURAI_ATTACKS.indexOf(k.attack) : NONE);
  w.u16(Math.round(Math.min(600, k.actionTime) * 100));
  w.u8(k.phase).u8(Math.round(Math.min(100, k.heat) * 2.55));
  w.u16(Math.round((((k.sweepAngle % 360) + 360) % 360) * 100));
  w.i16(Math.round(k.sweepPitch * 100)).u16(Math.round(k.sweepRange));
  w.u16(Math.round(Math.min(6000, raid.elapsed) * 10));
  w.u8(targetId ?? NONE)
    .u8(Math.min(255, k.vents))
    .u8(Math.min(255, k.decoyed));
  const pose = b.pose;
  w.u8(u8r(pose.armorOpen)).u8(u8r(pose.hatch)).u8(u8r(pose.gunGlow));
  w.u8(u8r(pose.exhaust)).u8(u8r(pose.purge));
  writeParts(w, k.parts);
  const missiles = k.shots.shots.filter((s) => s.active && s.kind === 'missile').slice(0, 64);
  w.u8(missiles.length);
  for (const s of missiles) writeMissile(w, s, b.position);
  return bytesOf(w);
}

function writeMissile(w: ByteWriter, s: Shot, o: { x: number; y: number; z: number }): void {
  w.i16(i16((s.position.x - o.x) / POS));
  w.i16(i16((s.position.y - o.y) / POS));
  w.i16(i16((s.position.z - o.z) / POS));
  const v = s.velocity;
  w.i8(i8(Math.atan2(-v.x, -v.z) / ANG)).i8(i8(Math.atan2(v.y, Math.hypot(v.x, v.z)) / ANG));
  w.u8((s.targetId < 0 ? 127 : s.targetId & 0x7f) | (s.decoyed ? 0x80 : 0));
  w.u8(Math.min(255, Math.round(s.age * 25)));
}

/** state を写しに読む */
export function readGouraiState(
  bytes: Uint8Array,
  raid: GouraiRaid,
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
  raid.raid = true;
  raid.players = players;
  b.patrol = { x: r.f32(), z: r.f32(), radius: r.f32() };
  b.waypoint = r.u8();
  const x = r.f32();
  const y = r.f32();
  const z = r.f32();
  const jump = !wasVisible || Math.hypot(x - b.position.x, y - b.position.y, z - b.position.z) > 60;
  b.position.x = x;
  b.position.y = y;
  b.position.z = z;
  b.heading = r.f32();
  b.pitch = r.i16() / 10000;
  b.roll = r.i16() / 10000;
  b.velocity.x = r.i16() / 100;
  b.velocity.z = r.i16() / 100;
  if (jump) {
    b.prevPosition.x = x;
    b.prevPosition.y = y;
    b.prevPosition.z = z;
    b.prevHeading = b.heading;
  }
  k.action = GOURAI_ACTIONS[r.u8()] ?? 'idle';
  k.attack = GOURAI_ATTACKS[r.u8()] ?? null;
  k.actionTime = r.u16() / 100;
  k.phase = r.u8();
  k.heat = r.u8() / 2.55;
  k.sweepAngle = r.u16() / 100;
  k.sweepPitch = r.i16() / 100;
  k.sweepRange = r.u16();
  raid.elapsed = r.u16() / 10;
  const tid = r.u8();
  out.targetId = tid === NONE ? null : tid;
  k.vents = r.u8();
  k.decoyed = r.u8();
  const pose = b.pose;
  pose.armorOpen = r.u8() / 255;
  pose.hatch = r.u8() / 255;
  pose.gunGlow = r.u8() / 255;
  pose.exhaust = r.u8() / 255;
  pose.purge = r.u8() / 255;
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
  // ミサイル: 写しのミサイルを消して、届いたものを空いた所に置き直す（機銃の弾はできごとで撃ったまま）
  const pool = k.shots.shots;
  for (const s of pool) if (s.kind === 'missile') s.active = false;
  const n = r.u8();
  const speed = GOURAI_SHOTS.missile.speed;
  for (let j = 0; j < n; j++) {
    const mx = b.position.x + r.i16() * POS;
    const my = b.position.y + r.i16() * POS;
    const mz = b.position.z + r.i16() * POS;
    const yaw = r.i8() * ANG;
    const pitch = r.i8() * ANG;
    const tb = r.u8();
    const age = r.u8() / 25;
    const s = pool.find((x) => !x.active);
    if (!s) continue;
    s.active = true;
    s.kind = 'missile';
    s.turret = 0;
    s.targetId = (tb & 0x7f) === 127 ? -1 : tb & 0x7f;
    s.decoyed = (tb & 0x80) !== 0;
    s.age = age;
    s.position.x = mx;
    s.position.y = my;
    s.position.z = mz;
    s.velocity.x = -Math.sin(yaw) * Math.cos(pitch) * speed;
    s.velocity.y = Math.sin(pitch) * speed;
    s.velocity.z = -Math.cos(yaw) * Math.cos(pitch) * speed;
  }
}

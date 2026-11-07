// 10-3b: 協力レイドの白鯨アルビオンの state の詰め方（net/albion-coop.ts のホスト → 写し）。体（周回路・位置・向き・傾き・速さ）・
// 攻撃の段・段階・雲・経過・攻撃の対象・部位（raid-kit-codec の writeParts）・飛んでいる子分（怪獣からの相対 0.5m の int16 × 3・
// 向きの int8 × 2・体力の u8・速さの u8。1 匹 11 バイト）。10-3c: 人を狙う攻撃の狙い（水柱の点と向き・歌の輪の中心・横転の側・
// 呼び声に応えた子分）。Three.js 非依存
import { ALBION_ACTIONS, ALBION_ATTACKS } from '../data/albion';
import { ALBION_RAID_CONFIG as R } from '../data/albion-raid';
import type { AlbionRaid } from '../missions/albion-raid';
import { ByteWriter } from './codec';
import { bytesOf, readParts, readerOf, writeParts } from './raid-kit-codec';

const NONE = 255;
const POS = 0.5;
const ANG = Math.PI / 127;

/** state の中身（ホスト → 写し） */
export function writeAlbionState(raid: AlbionRaid, targetId: number | null): Uint8Array {
  const k = raid.kaiju;
  const b = k.body;
  const w = new ByteWriter(320);
  const flags =
    (b.visible ? 1 : 0) |
    (raid.dead ? 2 : 0) |
    (raid.timeUp ? 4 : 0) |
    (raid.difficulty === 'hard' ? 8 : 0) |
    (b.turning ? 16 : 0);
  w.u8(flags).u8(Math.min(4, raid.players));
  w.f32(b.route.x).f32(b.route.z).f32(b.route.axis);
  w.f32(b.s).f32(b.position.x).f32(b.position.y).f32(b.position.z).f32(b.heading);
  w.i16(Math.round(b.bank * 10000)).i16(Math.round(b.pitch * 10000));
  w.u16(Math.round(b.speed * 100));
  w.u8(ALBION_ACTIONS.indexOf(k.action));
  w.u8(k.attack ? ALBION_ATTACKS.indexOf(k.attack) : NONE);
  w.u16(Math.round(Math.min(600, k.actionTime) * 100));
  w.u8(k.phase);
  w.u16(Math.round(k.cloudLeft * 100));
  w.u16(Math.round(Math.min(6000, raid.elapsed) * 10));
  w.u8(targetId ?? NONE);
  w.f32(k.aimX)
    .f32(k.aimZ)
    .i16(Math.round(wrap(k.aimAngle) * 10000));
  w.f32(k.sonarX).f32(k.sonarY).f32(k.sonarZ);
  w.i8(k.rollSide >= 0 ? 1 : -1).u16(k.callMask & 0xffff);
  writeParts(w, k.parts);
  const list = k.swarm.minions;
  let n = 0;
  for (const m of list) if (m.active) n++;
  w.u8(n);
  list.forEach((m, i) => {
    if (!m.active) return;
    w.u8(i);
    w.i16(i16((m.position.x - b.position.x) / POS));
    w.i16(i16((m.position.y - b.position.y) / POS));
    w.i16(i16((m.position.z - b.position.z) / POS));
    const v = m.velocity;
    w.i8(i8(Math.atan2(-v.x, -v.z) / ANG)).i8(i8(Math.atan2(v.y, Math.hypot(v.x, v.z)) / ANG));
    w.u8(Math.round(Math.min(1, Math.max(0, m.hp / k.swarm.spec.hp)) * 255));
    w.u8(Math.round(Math.min(510, Math.hypot(v.x, v.y, v.z)) / 2));
  });
  return bytesOf(w);
}

/** 角度を −π〜π に */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const i16 = (v: number): number => Math.round(Math.max(-32767, Math.min(32767, v)));
const i8 = (v: number): number => Math.round(Math.max(-127, Math.min(127, v)));

/** state を写しに読む */
export function readAlbionState(
  bytes: Uint8Array,
  raid: AlbionRaid,
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
  b.route = { ...b.route, x: r.f32(), z: r.f32(), axis: r.f32() };
  b.s = r.f32();
  const x = r.f32();
  const y = r.f32();
  const z = r.f32();
  const jump = !wasVisible || Math.hypot(x - b.position.x, y - b.position.y, z - b.position.z) > 60;
  b.position.x = x;
  b.position.y = y;
  b.position.z = z;
  b.heading = r.f32();
  b.bank = r.i16() / 10000;
  b.pitch = r.i16() / 10000;
  b.speed = r.u16() / 100;
  b.turning = (flags & 16) !== 0;
  if (jump) {
    b.prevPosition.x = x;
    b.prevPosition.y = y;
    b.prevPosition.z = z;
    b.prevHeading = b.heading;
    b.prevBank = b.bank;
  }
  k.action = ALBION_ACTIONS[r.u8()] ?? 'idle';
  const atk = r.u8();
  k.attack = ALBION_ATTACKS[atk] ?? null;
  k.actionTime = r.u16() / 100;
  k.phase = r.u8();
  k.cloudLeft = r.u16() / 100;
  raid.elapsed = r.u16() / 10;
  const tid = r.u8();
  out.targetId = tid === NONE ? null : tid;
  k.aimX = r.f32();
  k.aimZ = r.f32();
  k.aimAngle = r.i16() / 10000;
  k.sonarX = r.f32();
  k.sonarY = r.f32();
  k.sonarZ = r.f32();
  k.rollSide = r.i8() >= 0 ? 1 : -1;
  k.callMask = r.u16();
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
  const n = r.u8();
  const seen = new Set<number>();
  const list = k.swarm.minions;
  for (let j = 0; j < n; j++) {
    const i = r.u8();
    const mx = b.position.x + r.i16() * POS;
    const my = b.position.y + r.i16() * POS;
    const mz = b.position.z + r.i16() * POS;
    const yaw = r.i8() * ANG;
    const pitch = r.i8() * ANG;
    const hp = r.u8() / 255;
    const speed = r.u8() * 2;
    const m = list[i];
    if (!m) continue;
    seen.add(i);
    if (!m.active) m.age = 0;
    m.active = true;
    m.position.x = mx;
    m.position.y = my;
    m.position.z = mz;
    m.velocity.x = -Math.sin(yaw) * Math.cos(pitch) * speed;
    m.velocity.y = Math.sin(pitch) * speed;
    m.velocity.z = -Math.cos(yaw) * Math.cos(pitch) * speed;
    m.hp = hp * k.swarm.spec.hp;
  }
  list.forEach((m, i) => {
    if (!seen.has(i)) m.active = false;
  });
}

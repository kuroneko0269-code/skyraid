// 10-3c: 白鯨アルビオンの人を狙う攻撃の形と当たり（Three.js 非依存・決まった計算）: 水柱（進む先と斜め 4 か所の柱）・歌（体の高さを
// 広がる衝撃の輪）・横転（人の側の胸びれの払い）。呼び声（子分の囲みと突撃）は albion-minions.ts。どれも予兆の間は当たらず、
// 予兆を見て正しく避ければ当たらない（tests/albion-aimed.test.ts）
import { ALBION_CONFIG as C } from '../data/albion';
import type { Vec3 } from '../flight/math';
import type { AlbionBody } from '../entities/albion/albion-body';

const A = C.attacks;
const DEG = Math.PI / 180;

/** 水柱の狙い（予兆の始めに決める: 進む先の点と、進む向きの方位） */
export interface GeyserAim {
  readonly aimX: number;
  readonly aimZ: number;
  /** 進む向きの方位（ラジアン。北 −z から時計回り。体の heading と同じ決まり） */
  readonly aimAngle: number;
}

/** 水柱の数（真ん中 + 斜め 4） */
export const GEYSER_COUNT = 5;

/** i 本目の水柱の位置（水平）。0 は真ん中、1〜4 は進む向きから ±45°・±135° */
export function geyserPoint(aim: GeyserAim, i: number, out: { x: number; z: number }): void {
  if (i <= 0) {
    out.x = aim.aimX;
    out.z = aim.aimZ;
    return;
  }
  const a = aim.aimAngle + (45 + (i - 1) * 90) * DEG;
  out.x = aim.aimX - Math.sin(a) * A.geyser.ring;
  out.z = aim.aimZ - Math.cos(a) * A.geyser.ring;
}

/** 狙う人の位置と速度から水柱の狙いを決める（速度が小さければ今の位置・体へ向かう向き） */
export function geyserAimOf(
  p: Readonly<Vec3>,
  v: Readonly<Vec3> | undefined,
  body: AlbionBody,
  out: { aimX: number; aimZ: number; aimAngle: number },
): void {
  const vx = v?.x ?? 0;
  const vz = v?.z ?? 0;
  const sp = Math.hypot(vx, vz);
  out.aimX = p.x + vx * A.geyser.lead;
  out.aimZ = p.z + vz * A.geyser.lead;
  out.aimAngle =
    sp > 1 ? Math.atan2(-vx, -vz) : Math.atan2(-(body.position.x - p.x), -(body.position.z - p.z));
}

const gp = { x: 0, z: 0 };

/** 水柱の中か（t は攻撃の段の経過秒。柱は rise 秒で床から height まで伸びる） */
export function inGeyser(body: AlbionBody, aim: GeyserAim, t: number, p: Readonly<Vec3>): boolean {
  const g = A.geyser;
  const grow = Math.min(1, Math.max(0, t / g.rise));
  for (let i = 0; i < GEYSER_COUNT; i++) {
    geyserPoint(aim, i, gp);
    if (Math.hypot(p.x - gp.x, p.z - gp.z) > g.radius) continue;
    const floor = body.floorAt(gp.x, gp.z);
    if (p.y <= floor + g.height * grow) return true;
  }
  return false;
}

/** 歌の輪の半径（攻撃の段の経過秒 t） */
export function sonarRadius(t: number): number {
  return Math.min(A.sonar.maxRadius, A.sonar.start + A.sonar.speed * Math.max(0, t));
}

/** 歌の輪が広がりきるまでの秒数（攻撃の段の長さ） */
export function sonarSeconds(): number {
  return (A.sonar.maxRadius - A.sonar.start) / A.sonar.speed;
}

/** 歌の輪の中心（攻撃の始めの体の位置）と高さ */
export interface SonarOrigin {
  readonly sonarX: number;
  readonly sonarY: number;
  readonly sonarZ: number;
}

/** 歌の輪が、t − dt から t の間に p を通ったか（輪の厚さ ±width/2・上下 ±band） */
export function sonarPassed(o: SonarOrigin, t: number, dt: number, p: Readonly<Vec3>): boolean {
  const s = A.sonar;
  if (Math.abs(p.y - o.sonarY) > s.band) return false;
  const d = Math.hypot(p.x - o.sonarX, p.z - o.sonarZ);
  const r0 = sonarRadius(t - dt) - s.width / 2;
  const r1 = sonarRadius(t) + s.width / 2;
  return d >= r0 && d <= r1 && t - dt < sonarSeconds();
}

/** 体から見た点の位置: 前（体の中心から）・右（体の軸から。正で右）・上（体の中心から） */
export function bodyLocal(
  body: AlbionBody,
  p: Readonly<Vec3>,
): { along: number; side: number; above: number } {
  const fx = -Math.sin(body.heading);
  const fz = -Math.cos(body.heading);
  const dx = p.x - body.position.x;
  const dz = p.z - body.position.z;
  return { along: dx * fx + dz * fz, side: dx * -fz + dz * fx, above: p.y - body.position.y };
}

/** 横転を選べる所にいるか（体の横の近く） */
export function rollPick(body: AlbionBody, p: Readonly<Vec3>): boolean {
  const r = A.roll;
  const o = bodyLocal(body, p);
  return (
    Math.abs(o.side) <= r.pickSide &&
    Math.abs(o.side) >= r.minSide &&
    o.along <= r.pickFront &&
    o.along >= -r.pickBack &&
    Math.abs(o.above) <= r.pickBand
  );
}

/** 横転の払いの中か（side は払う側 1 = 右 / −1 = 左） */
export function inRoll(body: AlbionBody, side: number, p: Readonly<Vec3>): boolean {
  const r = A.roll;
  const o = bodyLocal(body, p);
  const s = o.side * side;
  return (
    s >= 30 &&
    s <= r.reach &&
    o.along <= r.front &&
    o.along >= r.back &&
    Math.abs(o.above) <= r.band
  );
}

/** 歌を選べる所にいるか（体の中心から水平 range・上下 pickBand 以内） */
export function sonarPick(body: AlbionBody, p: Readonly<Vec3>): boolean {
  const s = A.sonar;
  const d = Math.hypot(p.x - body.position.x, p.z - body.position.z);
  return d <= s.range && Math.abs(p.y - body.position.y) <= s.pickBand;
}

/** 水柱を選べる所にいるか（水平 range 以内） */
export function geyserPick(body: AlbionBody, p: Readonly<Vec3>): boolean {
  return Math.hypot(p.x - body.position.x, p.z - body.position.z) <= A.geyser.range;
}

// 10-3a: 白鯨アルビオンの攻撃の選び方と当たり（Three.js 非依存。決まった計算）。
// 潮吹き（背の上の柱）・尾の叩きつけ（尾の後ろの扇）・雲（体の周りの球）。予兆の間は当たらない（呼ぶ側が攻撃の段だけで見る）。
// 10-3c: 人を狙う攻撃（水柱・歌・横転・呼び声。形と当たりは albion-aimed.ts）の選び方と秒数
import { ALBION_CONFIG as C, type AlbionAttack } from '../data/albion';
import { geyserPick, rollPick, sonarPick, sonarSeconds } from './albion-aimed';
import { vec3, type Vec3 } from '../flight/math';
import type { AlbionBody } from '../entities/albion/albion-body';

const A = C.attacks;
const DEG = Math.PI / 180;
const tmp = vec3();

/** 攻撃を選ぶ側が読む状態（AlbionKaiju） */
export interface AttackChooser {
  readonly body: AlbionBody;
  readonly phase: number;
  readonly lastAttack: AlbionAttack | null;
  readonly repeat: number;
  readonly cloudLeft: number;
  disabled(action: string): boolean;
  /** 10-3c: 狙う人の近く（呼び声の範囲）に飛んでいる子分の数 */
  nearMinions(target: Readonly<Vec3>): number;
}

/** 噴気孔（潮吹きの柱の根元）の位置 */
export function blowhole(out: Vec3, body: AlbionBody): Vec3 {
  return body.point(out, { forward: A.spout.forward, right: 0, up: A.spout.up });
}

/** 尾の付け根（叩きつけの扇の要）の位置 */
export function tailPivot(out: Vec3, body: AlbionBody): Vec3 {
  return body.point(out, { forward: -A.slam.pivotBack, right: 0, up: 0 });
}

/** 点 p の、体の軸（頭から尾）からの水平の距離と、体の中心からの高さ */
export function axisOffset(body: AlbionBody, p: Readonly<Vec3>): { side: number; above: number } {
  const fx = -Math.sin(body.heading);
  const fz = -Math.cos(body.heading);
  const dx = p.x - body.position.x;
  const dz = p.z - body.position.z;
  const along = Math.max(-C.size.length / 2, Math.min(C.size.length / 2, dx * fx + dz * fz));
  const side = Math.hypot(dx - fx * along, dz - fz * along);
  return { side, above: p.y - body.position.y };
}

/** 潮吹きの柱の半径（段階 3 で太い） */
export function spoutRadius(phase: number): number {
  return A.spout.radius * (phase >= 3 ? A.spout.phase3Radius : 1);
}

/** 叩きつけの扇の半径（背びれが壊れると小さい） */
export function slamRadius(k: { mul(key: string): number }): number {
  return A.slam.radius * k.mul('slamRadius');
}

/** 潮吹きの柱の中か */
export function inSpout(body: AlbionBody, phase: number, p: Readonly<Vec3>): boolean {
  blowhole(tmp, body);
  const dy = p.y - tmp.y;
  return (
    dy >= 0 && dy <= A.spout.height && Math.hypot(p.x - tmp.x, p.z - tmp.z) <= spoutRadius(phase)
  );
}

/** 点 p の、尾の付け根からの距離と、真後ろからの角度（度）と高さの差 */
export function behind(
  body: AlbionBody,
  p: Readonly<Vec3>,
): { dist: number; angle: number; dy: number } {
  tailPivot(tmp, body);
  const dx = p.x - tmp.x;
  const dz = p.z - tmp.z;
  const dist = Math.hypot(dx, dz);
  // 後ろ = −前
  const bx = Math.sin(body.heading);
  const bz = Math.cos(body.heading);
  const cos = dist > 0 ? (dx * bx + dz * bz) / dist : 1;
  return { dist, angle: Math.acos(Math.max(-1, Math.min(1, cos))) / DEG, dy: p.y - tmp.y };
}

/** 叩きつけの扇の中か */
export function inSlam(body: AlbionBody, radius: number, p: Readonly<Vec3>): boolean {
  const b = behind(body, p);
  return b.dist <= radius && b.angle <= A.slam.halfAngle && Math.abs(b.dy) <= A.slam.band;
}

/** 雲の中か */
export function inCloud(body: AlbionBody, p: Readonly<Vec3>): boolean {
  const d = Math.hypot(p.x - body.position.x, p.y - body.position.y, p.z - body.position.z);
  return d <= A.cloud.radius;
}

/**
 * 使える攻撃と重み（値の表示・選び方）。target は狙う人（いなければ null: 潮吹きと雲だけ）。
 * 同じ攻撃は 3 回続けない（10-3b: ほかに候補が無いときは続けてよい。段階 1 で背の上・真後ろに誰もいないと潮吹きしか無く、
 * 2 回の後に攻撃しなくなっていた）
 */
export function attackWeights(
  k: AttackChooser,
  target: Readonly<Vec3> | null,
): { attack: AlbionAttack; weight: number }[] {
  const all = candidates(k, target);
  const fresh = all.filter((c) => !(k.lastAttack === c.attack && k.repeat >= 2));
  return fresh.length > 0 ? fresh : all;
}

function candidates(
  k: AttackChooser,
  target: Readonly<Vec3> | null,
): { attack: AlbionAttack; weight: number }[] {
  const out: { attack: AlbionAttack; weight: number }[] = [];
  const allow = (a: AlbionAttack): boolean => !k.disabled(a);
  if (allow('spout')) {
    let w = 1;
    if (target) {
      const o = axisOffset(k.body, target);
      if (o.side <= A.spout.aboveRange && o.above > 0 && o.above <= A.spout.height)
        w = A.spout.aboveWeight;
    }
    out.push({ attack: 'spout', weight: w });
  }
  if (allow('slam') && target) {
    const b = behind(k.body, target);
    if (b.dist <= A.slam.behindRange && b.angle <= A.slam.behindDeg)
      out.push({ attack: 'slam', weight: 3 });
  }
  if (allow('cloud') && k.phase >= A.cloud.fromPhase && k.cloudLeft <= 0)
    out.push({ attack: 'cloud', weight: A.cloud.weight });
  if (target) {
    if (geyserPick(k.body, target)) out.push({ attack: 'geyser', weight: A.geyser.weight });
    if (sonarPick(k.body, target)) out.push({ attack: 'sonar', weight: A.sonar.weight });
    if (rollPick(k.body, target)) out.push({ attack: 'roll', weight: A.roll.weight });
    if (k.nearMinions(target) >= A.call.minMinions)
      out.push({ attack: 'call', weight: A.call.weight });
  }
  return out;
}

/** 重みで 1 つ選ぶ（rnd は種の列）。候補が無ければ null */
export function chooseAttack(
  k: AttackChooser,
  target: Readonly<Vec3> | null,
  rnd: () => number,
): AlbionAttack | null {
  const list = attackWeights(k, target);
  const total = list.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const c of list) {
    r -= c.weight;
    if (r < 0) return c.attack;
  }
  return list[list.length - 1]?.attack ?? null;
}

/** 攻撃の段の秒数 */
const SONAR_TIMES = { windup: A.sonar.windup, active: sonarSeconds(), recover: A.sonar.recover };
const CLOUD_TIMES = { windup: A.cloud.windup, active: 0, recover: A.cloud.recover };

export function attackTimes(a: AlbionAttack): { windup: number; active: number; recover: number } {
  switch (a) {
    case 'spout':
      return A.spout;
    case 'slam':
      return A.slam;
    case 'geyser':
      return A.geyser;
    case 'sonar':
      return SONAR_TIMES;
    case 'roll':
      return A.roll;
    case 'call':
      return A.call;
    case 'cloud':
      return CLOUD_TIMES;
  }
}

// 10-4a: メカ怪獣ゴウライの大きな攻撃（ミサイルの一斉発射・回転掃射）の選び方と撃ち方。弾は 10-2 の ShotPool に入れる。
// 決まった計算（乱数は渡された種の列だけ）・Three.js 非依存
import {
  GOURAI_CONFIG as C,
  GOURAI_GUNS,
  GOURAI_PODS,
  GOURAI_TURRETS,
  type GouraiAttack,
} from '../data/gourai';
import { vec3, type Vec3 } from '../flight/math';
import type { ShotOrder } from './raid-kit/barrage';
import { bodyDirection, bodyPoint, relativeAim, type BodyFrame } from './raid-kit/frame';

/** 攻撃を選ぶ・撃つのに要る怪獣の形（gourai-ai.ts の GouraiKaiju） */
export interface GouraiAttackHost {
  readonly body: BodyFrame;
  readonly lastAttack: GouraiAttack | null;
  readonly repeat: number;
  /** 10-4b: 回転掃射の面の傾き（度）と、狙う人までの水平の距離（m）。予兆の始めに狙う人へ決める */
  readonly sweepPitch: number;
  readonly sweepRange: number;
  turretAlive(i: number): boolean;
}

export function attackTimes(a: GouraiAttack): { windup: number; active: number; recover: number } {
  return C.attacks[a];
}

/** 生きている砲台の数（list の中） */
export function aliveCount(
  k: Pick<GouraiAttackHost, 'turretAlive'>,
  list: readonly number[],
): number {
  let n = 0;
  for (const i of list) if (k.turretAlive(i)) n++;
  return n;
}

/** 使える攻撃と重み（値の表示・選び方）。p は狙う人の位置（いなければ空） */
export function attackWeights(
  k: GouraiAttackHost,
  p: Readonly<Vec3> | null,
): { attack: GouraiAttack; weight: number }[] {
  if (!p) return [];
  const b = k.body.position;
  const dist = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
  const out: { attack: GouraiAttack; weight: number }[] = [];
  const allow = (a: GouraiAttack): boolean => !(k.lastAttack === a && k.repeat >= 2);
  if (aliveCount(k, GOURAI_PODS) > 0 && dist <= C.attacks.volley.range && allow('volley'))
    out.push({ attack: 'volley', weight: 1 });
  const s = C.attacks.sweep;
  if (aliveCount(k, GOURAI_GUNS) > 0 && dist <= s.range && allow('sweep')) {
    // 10-4b: 掃射の面を傾けて届く高さなら選びやすい
    const raw = rawSweepPitch(k.body, p);
    const reach = raw >= s.pitchMin && raw <= s.pitchMax;
    out.push({ attack: 'sweep', weight: 1 + (reach ? s.levelWeight : 0) });
  }
  return out;
}

export function chooseAttack(
  k: GouraiAttackHost,
  p: Readonly<Vec3> | null,
  rnd: () => number,
): GouraiAttack | null {
  const list = attackWeights(k, p);
  const total = list.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const c of list) {
    r -= c.weight;
    if (r < 0) return c.attack;
  }
  return list[list.length - 1]?.attack ?? null;
}

const origin = vec3();
const dir = vec3();

/**
 * ミサイルの一斉発射: 生きているミサイルの砲台から交互に、狙う人の向きを中心に方位 ±fanDeg の扇へ打ち上げる（撃った数を返す）
 */
export function fireVolley(
  k: GouraiAttackHost,
  target: { readonly id: number; readonly position: Readonly<Vec3> },
  fire: (o: ShotOrder) => void,
): number {
  const v = C.attacks.volley;
  const pods = GOURAI_PODS.filter((i) => k.turretAlive(i));
  const total = pods.length * v.perPod;
  if (total === 0) return 0;
  const aim = relativeAim(k.body, k.body.position, target.position);
  for (let m = 0; m < total; m++) {
    const turret = pods[m % pods.length] ?? 0;
    const t = GOURAI_TURRETS[turret];
    if (!t) continue;
    bodyPoint(origin, k.body, t.offset);
    const yaw = aim.yawDeg + (total > 1 ? -v.fanDeg + (2 * v.fanDeg * m) / (total - 1) : 0);
    bodyDirection(dir, k.body, yaw, v.launchPitch);
    fire({ turret, weapon: 'missile', origin, direction: dir, targetId: target.id });
  }
  return total;
}

/**
 * 回転掃射の 1 回分: 生きている機銃が、体の向きから angleDeg + 90° × 機銃の番号の向きへ水平に 1 発ずつ（仰角は ±spreadDeg の散らばり）
 */
export function fireSweep(
  k: GouraiAttackHost,
  angleDeg: number,
  rnd: () => number,
  fire: (o: ShotOrder) => void,
): number {
  const s = C.attacks.sweep;
  let n = 0;
  GOURAI_GUNS.forEach((turret, j) => {
    const t = GOURAI_TURRETS[turret];
    if (!t || !k.turretAlive(turret)) return;
    bodyPoint(origin, k.body, t.offset);
    // 10-4b: 機銃ごとに、狙う人の距離（sweepRange）の輪の上で輪の真ん中の高さに届く仰角へ（機銃の位置の違いで高さがずれない）
    bodyDirection(dir, k.body, angleDeg + j * 90, 0);
    const b = k.body.position;
    const ox = origin.x - b.x;
    const oz = origin.z - b.z;
    const along = ox * dir.x + oz * dir.z;
    const c = ox * ox + oz * oz - k.sweepRange * k.sweepRange;
    const reach = Math.max(1, -along + Math.sqrt(Math.max(0, along * along - c)));
    const wantY = b.y + BAND_MID + k.sweepRange * Math.tan(k.sweepPitch * DEG);
    const pitch = Math.atan2(wantY - origin.y, reach) / DEG;
    bodyDirection(dir, k.body, angleDeg + j * 90, pitch + (rnd() - 0.5) * 2 * s.spreadDeg);
    fire({ turret, weapon: 'gun', origin, direction: dir, targetId: -1 });
    n++;
  });
  return n;
}

const DEG = Math.PI / 180;
const BAND_MID = (C.attacks.sweep.bandLow + C.attacks.sweep.bandHigh) / 2;

/** 10-4b: 掃射の面を p の高さへ向ける傾き（度。範囲で切らない） */
function rawSweepPitch(body: BodyFrame, p: Readonly<Vec3>): number {
  const b = body.position;
  const h = Math.hypot(p.x - b.x, p.z - b.z);
  return Math.atan2(p.y - b.y - BAND_MID, Math.max(1, h)) / DEG;
}

/** 10-4b: 回転掃射の面の傾き（度。p の高さへ向け、下限・上限で切る） */
export function sweepPitchFor(body: BodyFrame, p: Readonly<Vec3>): number {
  const s = C.attacks.sweep;
  return Math.max(s.pitchMin, Math.min(s.pitchMax, rawSweepPitch(body, p)));
}

/** 10-4b: 回転掃射を p（狙う人）へ向ける: 面の傾きと弾を揃える距離を決める */
export function aimSweep(
  k: { sweepPitch: number; sweepRange: number; readonly body: BodyFrame },
  p: Readonly<Vec3>,
): void {
  k.sweepPitch = sweepPitchFor(k.body, p);
  k.sweepRange = sweepRangeFor(k.body, p);
}

/** 10-4b: 回転掃射の弾を揃える水平の距離（m。p までの距離を 150〜射程で切る） */
export function sweepRangeFor(body: BodyFrame, p: Readonly<Vec3>): number {
  const b = body.position;
  return Math.max(150, Math.min(C.attacks.sweep.range, Math.hypot(p.x - b.x, p.z - b.z)));
}

/**
 * 点が回転掃射の危ない高さ（体の中心から bandLow〜bandHigh。10-4b: 面の傾き pitchDeg の分だけ、水平の距離に合わせて上下へずれる）に
 * あるか（テスト・値の表示・ボット）
 */
export function inSweepBand(body: BodyFrame, p: Readonly<Vec3>, pitchDeg = 0): boolean {
  const b = body.position;
  const h = Math.hypot(p.x - b.x, p.z - b.z);
  const dy = p.y - b.y - h * Math.tan(pitchDeg * DEG);
  return dy >= C.attacks.sweep.bandLow && dy <= C.attacks.sweep.bandHigh;
}

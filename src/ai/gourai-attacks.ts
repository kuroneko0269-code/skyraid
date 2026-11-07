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
  if (aliveCount(k, GOURAI_GUNS) > 0 && dist <= s.range && allow('sweep'))
    out.push({
      attack: 'sweep',
      weight: 1 + (Math.abs(p.y - b.y) < s.levelBand ? s.levelWeight : 0),
    });
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
    bodyDirection(dir, k.body, angleDeg + j * 90, (rnd() - 0.5) * 2 * s.spreadDeg);
    fire({ turret, weapon: 'gun', origin, direction: dir, targetId: -1 });
    n++;
  });
  return n;
}

/** 点が回転掃射の危ない高さ（体の中心から bandLow〜bandHigh）にあるか（テスト・値の表示） */
export function inSweepBand(body: BodyFrame, p: Readonly<Vec3>): boolean {
  const dy = p.y - body.position.y;
  return dy >= C.attacks.sweep.bandLow && dy <= C.attacks.sweep.bandHigh;
}

// 10-4a: メカ怪獣ゴウライの大きな攻撃（ミサイルの一斉発射・回転掃射）の選び方と撃ち方。弾は 10-2 の ShotPool に入れる。
// 決まった計算（乱数は渡された種の列だけ）・Three.js 非依存
import {
  GOURAI_CONFIG as C,
  GOURAI_GUNS,
  GOURAI_PODS,
  GOURAI_SHOTS,
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
  /** 10-4c: すき間の向き（1 = 上 / −1 = 下）と、撃った回数（段を回す） */
  readonly sweepSide: number;
  sweepShot: number;
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
 * 回転掃射の 1 回分: 生きている機銃が、体の向きから angleDeg + 90° × 機銃の番号の向きへ 1 発ずつ。10-4c: 機銃ごとに 2 つの輪の段を
 * 順に回り（機銃ごとにずらす）、機銃から水平に settle m の所でその段の高さ（傾きの面の上）へ寄せてから、面に沿って飛ぶ（輪の高さが
 * 距離で変わらない。予兆の輪と同じ）。予兆の輪の端（狙う人の距離 + beyond）で消える
 */
export function fireSweep(
  k: GouraiAttackHost,
  angleDeg: number,
  rnd: () => number,
  fire: (o: ShotOrder) => void,
): number {
  const s = C.attacks.sweep;
  let n = 0;
  const shot = k.sweepShot;
  const speed = GOURAI_SHOTS.gun.speed;
  const life = (k.sweepRange + s.beyond) / speed;
  const tan = Math.tan(k.sweepPitch * DEG);
  GOURAI_GUNS.forEach((turret, j) => {
    const t = GOURAI_TURRETS[turret];
    if (!t || !k.turretAlive(turret)) return;
    bodyPoint(origin, k.body, t.offset);
    bodyDirection(dir, k.body, angleDeg + j * 90, 0);
    const b = k.body.position;
    // 機銃の水平の位置の、向きに沿った距離（体の中心から）
    const along = (origin.x - b.x) * dir.x + (origin.z - b.z) * dir.z;
    const layer = SWEEP_LAYERS[(shot + j * LAYER_SKEW) % SWEEP_LAYERS.length] ?? 0;
    const jitter = (rnd() - 0.5) * 2 * s.spreadDeg * DEG * k.sweepRange;
    const settleY = b.y + layer * k.sweepSide + jitter + (along + s.settle) * tan;
    // 水平の速さ vh で settle m 進む間に settleY へ。その後は面の傾き（vh × tan）
    const rise = (settleY - origin.y) / s.settle;
    const vh = speed / Math.hypot(1, rise);
    dir.x *= vh / speed;
    dir.z *= vh / speed;
    dir.y = (vh * rise) / speed;
    fire({
      turret,
      weapon: 'gun',
      origin,
      direction: dir,
      targetId: -1,
      life,
      bendAge: s.settle / vh,
      bendVy: vh * tan,
    });
    n++;
  });
  k.sweepShot = shot + 1;
  return n;
}

const DEG = Math.PI / 180;

/** 段の高さ（狙う人の高さ = 0。すき間が上の向き）を、続けて撃つ弾が離れた段へ行く順に並べたもの */
function buildLayers(): number[] {
  const s = C.attacks.sweep;
  const list: number[] = [];
  const ring = (r: readonly [number, number], n: number): void => {
    for (let i = 0; i < n; i++) list.push(r[0] + ((r[1] - r[0]) * (i + 0.5)) / n);
  };
  ring(s.near, s.layersNear);
  ring(s.far, s.layersFar);
  list.sort((a, b) => a - b);
  // 歩幅 STRIDE で並べ替える（段の数と互いに素）
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[(i * STRIDE) % list.length] ?? 0);
  return out;
}

const STRIDE = 4;
/** 機銃ごとに段をずらす数 */
const LAYER_SKEW = 2;
export const SWEEP_LAYERS: readonly number[] = buildLayers();

/** 10-4b: 掃射の面を p の高さへ向ける傾き（度。範囲で切らない）。10-4c: 狙う人の高さ（近い輪の中）へ */
function rawSweepPitch(body: BodyFrame, p: Readonly<Vec3>): number {
  const b = body.position;
  const h = Math.hypot(p.x - b.x, p.z - b.z);
  return Math.atan2(p.y - b.y, Math.max(1, h)) / DEG;
}

/** 10-4b: 回転掃射の面の傾き（度。p の高さへ向け、下限・上限で切る） */
export function sweepPitchFor(body: BodyFrame, p: Readonly<Vec3>): number {
  const s = C.attacks.sweep;
  return Math.max(s.pitchMin, Math.min(s.pitchMax, rawSweepPitch(body, p)));
}

/**
 * 10-4b: 回転掃射を p（狙う人）へ向ける: 面の傾きと弾を揃える距離を決める。10-4c: すき間の向きも（床 floor に近ければ上・ほかは
 * 種の乱数で上か下）
 */
export function aimSweep(
  k: { sweepPitch: number; sweepRange: number; sweepSide: number; readonly body: BodyFrame },
  p: Readonly<Vec3>,
  floor: number,
  rnd: () => number,
): void {
  k.sweepPitch = sweepPitchFor(k.body, p);
  k.sweepRange = sweepRangeFor(k.body, p);
  const r = rnd();
  k.sweepSide = p.y - floor < C.attacks.sweep.lowFloor || r < 0.5 ? 1 : -1;
}

/** 10-4b: 回転掃射の弾を揃える水平の距離（m。p までの距離を 150〜射程で切る） */
export function sweepRangeFor(body: BodyFrame, p: Readonly<Vec3>): number {
  const b = body.position;
  return Math.max(150, Math.min(C.attacks.sweep.range, Math.hypot(p.x - b.x, p.z - b.z)));
}

/** 回転掃射の向き（予兆の輪・判定のなぞり）に要る形 */
export interface SweepView {
  readonly body: BodyFrame;
  readonly sweepPitch: number;
  readonly sweepRange: number;
  readonly sweepSide: number;
}

/** 10-4c: 点 p が、輪の段の高さの基準（狙う人の高さ = 0。傾きの面からの上下）で見て何 m の所か */
export function sweepOffset(k: SweepView, p: Readonly<Vec3>): number {
  const b = k.body.position;
  const h = Math.hypot(p.x - b.x, p.z - b.z);
  return p.y - b.y - h * Math.tan(k.sweepPitch * DEG);
}

/** 10-4c: 輪の上下の幅（基準の高さから。side を入れた [下, 上]） */
export function sweepRing(ring: readonly [number, number], side: number): [number, number] {
  return side >= 0 ? [ring[0], ring[1]] : [-ring[1], -ring[0]];
}

/**
 * 点が回転掃射の危ない高さ（2 つの輪のどちらか。margin m だけ広げる）にあるか（テスト・値の表示・ボット）。
 * 10-4c: 輪 2 つと、距離で縮む分も入れた
 */
export function inSweepBand(k: SweepView, p: Readonly<Vec3>, margin = 0): boolean {
  const s = C.attacks.sweep;
  if (!inSweepReach(k, p)) return false;
  const off = sweepOffset(k, p);
  for (const r of [s.near, s.far]) {
    const [lo, hi] = sweepRing(r, k.sweepSide);
    if (off >= lo - margin && off <= hi + margin) return true;
  }
  return false;
}

/** 10-4c: 弾が届く距離の内か（狙う人の距離 + beyond） */
export function inSweepReach(k: SweepView, p: Readonly<Vec3>): boolean {
  const b = k.body.position;
  return Math.hypot(p.x - b.x, p.z - b.z) <= k.sweepRange + C.attacks.sweep.beyond;
}

/** 10-4c: 点がすき間（2 つの輪の間）にあるか */
export function inSweepGap(k: SweepView, p: Readonly<Vec3>): boolean {
  const s = C.attacks.sweep;
  const off = sweepOffset(k, p) * (k.sweepSide >= 0 ? 1 : -1);
  return off > s.near[1] && off < s.far[0];
}

// AI の知覚と判断の材料（Three.js 非依存）: 発見判定・予測位置・後方を取れたか・射撃条件。すべて純関数
import { leadPoint } from '../combat/lead';
import { AI_CONFIG, type DifficultySpec } from '../data/ai';
import type { GunSpec } from '../data/weapons';
import { clamp, type Vec3 } from '../flight/math';

const DEG = Math.PI / 180;

export type DetectionConfig = typeof AI_CONFIG.detection;
export type AttackConfig = typeof AI_CONFIG.attack;

export function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** forward（単位ベクトル）と from → to のなす角（度）。距離 0 なら 0 */
export function angleToDeg(
  from: Readonly<Vec3>,
  forward: Readonly<Vec3>,
  to: Readonly<Vec3>,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dy, dz);
  if (d === 0) return 0;
  const c = (dx * forward.x + dy * forward.y + dz * forward.z) / d;
  return Math.acos(clamp(c, -1, 1)) / DEG;
}

/** 発見判定: range 以内かつ機首から ±fovDeg、または closeRange 以内なら向きによらず見つける */
export function canDetect(
  self: Readonly<Vec3>,
  forward: Readonly<Vec3>,
  target: Readonly<Vec3>,
  cfg: DetectionConfig = AI_CONFIG.detection,
): boolean {
  const d = distance(self, target);
  if (d <= cfg.closeRange) return true;
  if (d > cfg.range) return false;
  return angleToDeg(self, forward, target) <= cfg.fovDeg;
}

/**
 * 迎撃の予測時間: 速さ speed で直進して、等速で動く相手に追いつく時間。
 * 解が無い（相手の方が速く離れていく）ときは「今の距離 ÷ 速さ」。0〜maxSeconds に収める
 */
export function interceptTime(
  from: Readonly<Vec3>,
  speed: number,
  targetPos: Readonly<Vec3>,
  targetVel: Readonly<Vec3>,
  maxSeconds: number,
  scratch: Vec3,
): number {
  if (speed <= 0) return 0;
  const t = leadPoint(scratch, from, speed, targetPos, targetVel, 0, maxSeconds);
  if (t >= 0) return t;
  return clamp(distance(from, targetPos) / speed, 0, maxSeconds);
}

/** 相手の t 秒後の位置（等速直線）を out に書く */
export function predictPosition(
  out: Vec3,
  pos: Readonly<Vec3>,
  vel: Readonly<Vec3>,
  t: number,
): Vec3 {
  out.x = pos.x + vel.x * t;
  out.y = pos.y + vel.y * t;
  out.z = pos.z + vel.z * t;
  return out;
}

/**
 * 追尾の狙い: 相手の予測位置（迎撃の予測時間後）から、相手の進行方向の後ろへ rearOffset ずらした点。
 * 純追尾（今の位置へ向かう）だと相手の後ろを回り続けるので、先回りして後方につける
 */
export function pursuitPoint(
  out: Vec3,
  self: Readonly<Vec3>,
  selfSpeed: number,
  targetPos: Readonly<Vec3>,
  targetVel: Readonly<Vec3>,
  rearOffset: number,
  maxPredictSeconds: number,
): Vec3 {
  const t = interceptTime(self, selfSpeed, targetPos, targetVel, maxPredictSeconds, out);
  predictPosition(out, targetPos, targetVel, t);
  const v = Math.hypot(targetVel.x, targetVel.y, targetVel.z);
  if (v > 1e-6) {
    // 近づくほど後ろへのずらしを減らす（最後は相手そのものを狙う）
    const k = (rearOffset * clamp(distance(self, out) / (rearOffset * 4), 0, 1)) / v;
    out.x -= targetVel.x * k;
    out.y -= targetVel.y * k;
    out.z -= targetVel.z * k;
  }
  return out;
}

/**
 * 相手の尾部から見た自分の角度（度）。0 = 真後ろ、180 = 真正面。
 * targetForward は相手の進行方向（単位ベクトル）
 */
export function tailAngleDeg(
  self: Readonly<Vec3>,
  targetPos: Readonly<Vec3>,
  targetForward: Readonly<Vec3>,
): number {
  const back = { x: -targetForward.x, y: -targetForward.y, z: -targetForward.z };
  return angleToDeg(targetPos, back, self);
}

/** 後方を取れているか: 相手の尾部から ±rearConeDeg・rearRange 以内 */
export function hasRearPosition(
  self: Readonly<Vec3>,
  targetPos: Readonly<Vec3>,
  targetForward: Readonly<Vec3>,
  cfg: { readonly rearConeDeg: number; readonly rearRange: number } = AI_CONFIG.engage,
): boolean {
  if (distance(self, targetPos) > cfg.rearRange) return false;
  return tailAngleDeg(self, targetPos, targetForward) <= cfg.rearConeDeg;
}

/**
 * 機銃の予測照準点（プレイヤーの照準と同じ式。弾速 = 機速 + 初速、重力で落ちる分だけ上）。
 * targetAcc（相手の加速度 = 旋回）を渡すと、当たるまでの時間 t に対して accWeight × a t² / 2 だけ先へずらす
 * （旋回中の相手は等速直線の予測だと外側へ外れる）。射程内に解があれば out に書いて t、なければ -1
 */
export function gunLeadPoint(
  out: Vec3,
  shooter: Readonly<Vec3>,
  shooterSpeed: number,
  targetPos: Readonly<Vec3>,
  targetVel: Readonly<Vec3>,
  gun: GunSpec,
  targetAcc: Readonly<Vec3> | null = null,
  accWeight = 0,
): number {
  const speed = shooterSpeed + gun.muzzleSpeed;
  const t = leadPoint(out, shooter, speed, targetPos, targetVel, gun.gravity, gun.range / speed);
  if (t < 0 || !targetAcc || accWeight === 0) return t;
  const k = 0.5 * accWeight * t * t;
  out.x += targetAcc.x * k;
  out.y += targetAcc.y * k;
  out.z += targetAcc.z * k;
  return t;
}

/** 機銃を撃つ条件: 予測照準点が機首から gunConeDeg 以内で、距離が gunRange 以内 */
export function canFireGun(
  noseToLeadDeg: number,
  dist: number,
  diff: Pick<DifficultySpec, 'gunConeDeg'>,
  cfg: Pick<AttackConfig, 'gunRange'> = AI_CONFIG.attack,
): boolean {
  return dist <= cfg.gunRange && noseToLeadDeg <= diff.gunConeDeg;
}

/** 攻撃に移る条件（entering = true）と、攻撃を続ける条件（false。exit* 倍まで緩める） */
export function inAttackWindow(
  noseToLeadDeg: number,
  dist: number,
  entering: boolean,
  cfg: AttackConfig = AI_CONFIG.attack,
): boolean {
  const range = entering ? cfg.range : cfg.range * cfg.exitRangeFactor;
  const cone = entering ? cfg.coneDeg : cfg.coneDeg * cfg.exitConeFactor;
  return dist <= range && noseToLeadDeg <= cone;
}

/** 地面の回避が必要か: 地表から minAgl 未満、または今の上下の速さのまま lookAheadSeconds 後に切る */
export function needsGroundAvoid(
  agl: number,
  verticalSpeed: number,
  cfg: typeof AI_CONFIG.ground = AI_CONFIG.ground,
): boolean {
  return agl < cfg.minAgl || agl + Math.min(0, verticalSpeed) * cfg.lookAheadSeconds < cfg.minAgl;
}

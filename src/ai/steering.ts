// AI の操縦（Three.js 非依存）: 「この方向へ機首を向けたい」を飛行モデルの入力（pitch / roll / yaw）に変える。
// 物理はプレイヤーと共通（src/flight/）なので、AI は入力値を出すだけ
import { AI_CONFIG } from '../data/ai';
import type { AircraftSpec } from '../data/aircraft';
import { turnFactor } from '../flight/flight-model';
import { clamp, vec3, type Quat, type Vec3 } from '../flight/math';

export type SteerConfig = typeof AI_CONFIG.steer;

export interface SteerOutput {
  pitch: number;
  roll: number;
  yaw: number;
}

const DEG = Math.PI / 180;
const G = 9.8;
const local = vec3();
const localRate = vec3();

/** 今の速度での最大のピッチ・ヨー角速度（rad/s、入力 1 のとき） */
export interface TurnRates {
  pitch: number;
  yaw: number;
}

export function turnRates(out: TurnRates, spec: AircraftSpec, speed: number): TurnRates {
  const k = turnFactor(spec.turnCurve, speed) * DEG;
  out.pitch = spec.rates.pitch * k;
  out.yaw = spec.rates.yaw * k;
  return out;
}

/** v を q の逆回転で回す（ワールド → 機体ローカル）。out と v は同じでもよい */
export function toLocal(out: Vec3, q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  // 共役クォータニオン (-x, -y, -z, w) で回す
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  const x = v.x + q.w * tx + (qy * tz - qz * ty);
  const y = v.y + q.w * ty + (qz * tx - qx * tz);
  const z = v.z + q.w * tz + (qx * ty - qy * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/**
 * maxG を超えないピッチ入力の上限（0〜1）。ゲーム内の G = 速度 × ピッチ角速度 / 9.8。
 * ピッチ角速度は pitch 入力 × rates.pitch × 旋回係数（速度の折れ線）
 */
export function pitchLimitForG(spec: AircraftSpec, speed: number, maxG: number): number {
  const rate = spec.rates.pitch * turnFactor(spec.turnCurve, speed) * DEG;
  if (rate <= 0 || speed <= 0) return 1;
  return clamp((maxG * G) / (speed * rate), 0, 1);
}

/**
 * 機首を dir（ワールド、長さは問わない）へ向ける入力を out に書く。
 * - 狙いが機首から離れているとき: ロールで狙いを機体の頭上に置き、ピッチで引き寄せる（戦闘機の旋回）
 * - 近いとき（fineAngleDeg 未満）: ロールは止め、ピッチとヨーで細かく合わせる
 * angularRate は機体ローカルの角速度（FlightState.angularRate）。行き過ぎを抑えるダンピングに使う。
 * aimRate（ワールド、rad/s）は狙いの向きが回る速さ。動く狙いを追うのに必要な角速度を先に入れる（フィードフォワード）。
 * 比例だけだと、旋回する相手を追うときに角速度の分だけ遅れが残る
 */
export function steerToward(
  out: SteerOutput,
  orientation: Readonly<Quat>,
  angularRate: Readonly<Vec3>,
  dir: Readonly<Vec3>,
  maxPitch: number,
  cfg: SteerConfig = AI_CONFIG.steer,
  aimRate: Readonly<Vec3> | null = null,
  rates: Readonly<TurnRates> | null = null,
): SteerOutput {
  const l = toLocal(local, orientation, dir);
  const len = Math.hypot(l.x, l.y, l.z);
  if (len < 1e-9) {
    out.pitch = out.roll = out.yaw = 0;
    return out;
  }
  const fx = l.x / len;
  const fy = l.y / len;
  const fz = l.z / len;
  // 機首（-Z）とのなす角
  const off = Math.acos(clamp(-fz, -1, 1));
  // 狙いの、機首軸まわりの向き（頭上 0・右 +）
  const rollError = Math.atan2(fx, fy);
  const fine = smooth01(off / (cfg.fineAngleDeg * DEG));

  // 右ロールの角速度 = -angularRate.z、機首上げ = angularRate.x、右ヨー = -angularRate.y
  const rollRate = -angularRate.z;
  out.roll = clamp(cfg.rollGain * rollError * fine - cfg.rollDamping * rollRate, -1, 1);

  // 機体の上下面での狙いの角度（真後ろなら ±π）。頭上の狙いは引き、足元はロールで頭上へ回してから引く
  const pitchError = Math.atan2(fy, -fz);
  let pitchFf = 0;
  let yawFf = 0;
  if (aimRate && rates && fz < 0) {
    // 狙いの回転を機体ローカルへ。+X 回り = 機首上げ、-Y 回り = 右ヨー
    const w = toLocal(localRate, orientation, aimRate);
    if (rates.pitch > 0) pitchFf = w.x / rates.pitch;
    if (rates.yaw > 0) yawFf = -w.y / rates.yaw;
  }
  const pull = cfg.pitchGain * pitchError - cfg.pitchDamping * angularRate.x + pitchFf;
  out.pitch = clamp(pull, -cfg.pushLimit * maxPitch, maxPitch);

  const yawError = Math.atan2(fx, -fz);
  out.yaw = fz < 0 ? clamp(cfg.yawGain * yawError + 0.1 * angularRate.y + yawFf, -1, 1) : 0;
  return out;
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

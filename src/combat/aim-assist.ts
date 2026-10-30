// エイムアシスト（4-12、Three.js 非依存）: 選択中の対象が機首の近くにあるとき、操縦の入力を対象の側へ少しだけ足す。
// 飛行モデルの数値は変えず、入力だけを補う。操縦の入力が 0 なら何もしない（勝手に追わない）
import { AIM_ASSIST_CONFIG } from '../data/assist';
import type { AircraftControls } from '../entities/aircraft';
import { clamp, inverseRotateVec3, smoothstep, type Quat, type Vec3 } from '../flight/math';

const DEG = Math.PI / 180;
const local: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * controls に補正を足す。aim は狙う点（ワールド）、position・orientation は自機。invertPitch はピッチ反転の設定
 * （飛行モデルが入力の符号を反転するので、補正も同じだけ反転して足す）。足したら true
 */
export function applyAimAssist(
  controls: AircraftControls,
  position: Readonly<Vec3>,
  orientation: Readonly<Quat>,
  aim: Readonly<Vec3>,
  invertPitch: boolean,
  c: typeof AIM_ASSIST_CONFIG = AIM_ASSIST_CONFIG,
): boolean {
  const input = Math.max(Math.abs(controls.pitch), Math.abs(controls.roll), Math.abs(controls.yaw));
  if (input === 0) return false;
  local.x = aim.x - position.x;
  local.y = aim.y - position.y;
  local.z = aim.z - position.z;
  inverseRotateVec3(local, orientation, local);
  // 機首は -Z。後ろ・真横は対象外
  const ahead = -local.z;
  if (ahead <= 0) return false;
  const angle = Math.atan2(Math.hypot(local.x, local.y), ahead) / DEG;
  if (angle > c.coneDeg) return false;
  const strength =
    Math.min(1, input / c.fullInput) *
    (1 - smoothstep(c.coneDeg - c.edgeFadeDeg, c.coneDeg, angle));
  const full = c.fullCorrectionDeg * DEG;
  const k = c.maxCorrection * strength;
  // 上にあれば機首上げ（pitch +）、右にあれば機首右（yaw +）
  const pitch = clamp(Math.atan2(local.y, ahead) / full, -1, 1) * k;
  const yaw = clamp(Math.atan2(local.x, ahead) / full, -1, 1) * k;
  controls.pitch = clamp(controls.pitch + (invertPitch ? -pitch : pitch), -1, 1);
  controls.yaw = clamp(controls.yaw + yaw, -1, 1);
  return true;
}

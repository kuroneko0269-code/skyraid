// PvP のテストのボット（5-3 の pvp-combat.test.ts から 5-4 で分けた）: 相手の予測照準点へ機首を向ける操作
import type { Aircraft, AircraftControls } from '../src/entities/aircraft';
import { inverseRotateVec3, rotateVec3, type Vec3 } from '../src/flight/math';

export interface Target {
  readonly position: Readonly<Vec3>;
  readonly velocity: Readonly<Vec3>;
}

const local = { x: 0, y: 0, z: 0 };
const vel = { x: 0, y: 0, z: 0 };
const aimPoint = { x: 0, y: 0, z: 0 };

/**
 * 相手を追う操作（予測照準点へ機首を向ける）。機首と照準点の角度（度）を返す。
 * 高度 250m より下では上昇を優先する（平らな地面に落ちにくく）
 */
export function pursue(out: AircraftControls, a: Aircraft, t: Target): number {
  const p = a.state.position;
  const d = Math.hypot(t.position.x - p.x, t.position.y - p.y, t.position.z - p.z);
  const time = d / (a.state.speed + 900);
  aimPoint.x = t.position.x + t.velocity.x * time;
  aimPoint.y = t.position.y + t.velocity.y * time;
  aimPoint.z = t.position.z + t.velocity.z * time;
  local.x = aimPoint.x - p.x;
  local.y = aimPoint.y - p.y;
  local.z = aimPoint.z - p.z;
  inverseRotateVec3(local, a.state.orientation, local);
  const off = Math.atan2(Math.hypot(local.x, local.y), -local.z);
  // 照準点を機体の真上へ回してから引き起こす（近ければ直接）
  const roll = Math.atan2(local.x, local.y);
  out.roll = Math.max(-1, Math.min(1, off > 0.05 ? 2 * roll : 4 * Math.atan2(local.x, -local.z)));
  out.pitch = Math.max(-1, Math.min(1, 6 * Math.atan2(local.y, -local.z)));
  out.yaw = Math.max(-1, Math.min(1, 3 * Math.atan2(local.x, -local.z)));
  out.throttle = 0;
  out.throttleTarget = 0.8;
  out.afterburner = false;
  if (p.y < 250) {
    rotateVec3(vel, a.state.orientation, { x: 1, y: 0, z: 0 });
    out.roll = Math.max(-1, Math.min(1, 3 * vel.y));
    out.pitch = 1;
  }
  return (off * 180) / Math.PI;
}

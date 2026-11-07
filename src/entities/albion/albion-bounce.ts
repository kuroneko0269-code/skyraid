// 10-3c: 白鯨アルビオンの体にぶつかった機体を弾く（Three.js 非依存）。体の面で機首の向きを跳ね返し（面から外へ少なくとも minExit）、
// 速さを落とし、面の外（pushOut m）へ置く。描画の補間は弾いた位置から（前の位置も置き直す: 体の中を通る線を描かない）。
// ソロ（missions/albion-dev.ts の固定ステップ）と協力のホスト（net/albion-coop.ts。参加者の機体）で同じものを使う
import { ALBION_CONFIG as C } from '../../data/albion';
import { LOCAL_FORWARD, LOCAL_UP } from '../../flight/flight-model';
import {
  copyQuat,
  copyVec3,
  multiplyQuat,
  normalizeQuat,
  quatFromRotationVector,
  quatIdentity,
  rotateVec3,
  vec3,
} from '../../flight/math';
import type { HullContact } from '../../ai/albion-hull';
import type { Aircraft } from '../aircraft';

const fwd = vec3();
const up = vec3();
const rot = quatIdentity();
const out = quatIdentity();

/** 弾き方の数値（10-4b: ゴウライも同じ形の数値で使う） */
export interface BounceSpec {
  readonly pushOut: number;
  readonly speedKeep: number;
  readonly minExit: number;
}

/** 弾く。contact は hullContact の結果（めり込んだ点・深さ・外向き）。B は弾き方（省略はアルビオンの数値） */
export function bounceAircraft(
  a: Aircraft,
  contact: Readonly<HullContact>,
  B: BounceSpec = C.collision,
): void {
  const s = a.state;
  const n = contact.normal;
  rotateVec3(fwd, s.orientation, LOCAL_FORWARD);
  // 跳ね返す（面へ向かう成分を反対に）。面から外への成分が足りなければ足す
  const dot = fwd.x * n.x + fwd.y * n.y + fwd.z * n.z;
  let wx = fwd.x;
  let wy = fwd.y;
  let wz = fwd.z;
  if (dot < 0) {
    wx -= 2 * dot * n.x;
    wy -= 2 * dot * n.y;
    wz -= 2 * dot * n.z;
  }
  const out1 = wx * n.x + wy * n.y + wz * n.z;
  if (out1 < B.minExit) {
    const add = B.minExit - out1;
    wx += n.x * add;
    wy += n.y * add;
    wz += n.z * add;
  }
  const wl = Math.hypot(wx, wy, wz) || 1;
  wx /= wl;
  wy /= wl;
  wz /= wl;
  // 前 → 新しい前への回転を、世界の側から掛ける
  let ax = fwd.y * wz - fwd.z * wy;
  let ay = fwd.z * wx - fwd.x * wz;
  let az = fwd.x * wy - fwd.y * wx;
  let sin = Math.hypot(ax, ay, az);
  const cos = Math.max(-1, Math.min(1, fwd.x * wx + fwd.y * wy + fwd.z * wz));
  if (sin <= 1e-6 && cos < 0) {
    // 真正面から: 機体の上の向きの周りに半回転
    rotateVec3(up, s.orientation, LOCAL_UP);
    ax = up.x;
    ay = up.y;
    az = up.z;
    sin = Math.hypot(ax, ay, az);
  }
  const angle = Math.atan2(
    Math.hypot(fwd.y * wz - fwd.z * wy, fwd.z * wx - fwd.x * wz, fwd.x * wy - fwd.y * wx),
    cos,
  );
  if (sin > 1e-6) {
    quatFromRotationVector(rot, (ax / sin) * angle, (ay / sin) * angle, (az / sin) * angle);
    multiplyQuat(out, rot, s.orientation);
    normalizeQuat(out);
    copyQuat(s.orientation, out);
  }
  s.angularRate.x = 0;
  s.angularRate.y = 0;
  s.angularRate.z = 0;
  s.speed *= B.speedKeep;
  const p = contact.point;
  const push = contact.depth + B.pushOut;
  s.position.x = p.x + n.x * push;
  s.position.y = p.y + n.y * push;
  s.position.z = p.z + n.z * push;
  copyVec3(a.prevPosition, s.position);
  copyQuat(a.prevOrientation, s.orientation);
}

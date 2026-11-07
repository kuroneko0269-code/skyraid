// 10-2: レイドの怪獣の共通の部品（src/ai/raid-kit/）の土台: 体の基準（位置と水平の向き）と、体に付いた点（巣・砲台・口）の
// 世界の位置。部品はすべて決まった計算（乱数は渡された種の列だけ。時刻は固定ステップの dt の足し算だけ）で、
// 状態は数・配列だけのプロパティに持つ（リプレイのキーフレームと状態のハッシュにそのまま入る。src/replay/state-walk.ts）。
// Three.js・DOM 非依存
import type { Vec3 } from '../../flight/math';

/** 体に付いた点（体の基準からの相対。前 = +forward、右 = +right、上 = +up。m） */
export interface BodyOffset {
  readonly forward: number;
  readonly right: number;
  readonly up: number;
}

/** 体の基準（位置と、水平の向きの方位。heading は北（-z）から時計回りのラジアン。ヴォルガスの kaiju.heading と同じ） */
export interface BodyFrame {
  readonly position: Readonly<Vec3>;
  readonly heading: number;
}

/** 体に付いた点の世界の位置を out に入れる */
export function bodyPoint(out: Vec3, body: BodyFrame, o: BodyOffset): Vec3 {
  const fx = -Math.sin(body.heading);
  const fz = -Math.cos(body.heading);
  // 右 = 前を上から見て時計回りに 90°
  const rx = -fz;
  const rz = fx;
  out.x = body.position.x + fx * o.forward + rx * o.right;
  out.y = body.position.y + o.up;
  out.z = body.position.z + fz * o.forward + rz * o.right;
  return out;
}

/** 方位（体の向きからの相対の度）と仰角（度）の向きを out に入れる（単位ベクトル） */
export function bodyDirection(out: Vec3, body: BodyFrame, yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = body.heading + (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const c = Math.cos(pitch);
  out.x = -Math.sin(yaw) * c;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * c;
  return out;
}

/** from から to への向き（体の向きからの相対の方位・仰角の度）。同じ点なら 0, 0 */
export function relativeAim(
  body: BodyFrame,
  from: Readonly<Vec3>,
  to: Readonly<Vec3>,
): { yawDeg: number; pitchDeg: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const h = Math.hypot(dx, dz);
  if (h === 0 && dy === 0) return { yawDeg: 0, pitchDeg: 0 };
  const yaw = Math.atan2(-dx, -dz) - body.heading;
  return { yawDeg: wrapDeg((yaw * 180) / Math.PI), pitchDeg: (Math.atan2(dy, h) * 180) / Math.PI };
}

/** 度を -180〜180 に */
export function wrapDeg(d: number): number {
  let v = d % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
}

export function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 点 p から、o を通る向き d（単位）の長さ len の線分までの距離 */
export function segmentDistance(
  p: Readonly<Vec3>,
  o: Readonly<Vec3>,
  d: Readonly<Vec3>,
  len: number,
): number {
  const px = p.x - o.x;
  const py = p.y - o.y;
  const pz = p.z - o.z;
  const s = Math.max(0, Math.min(len, px * d.x + py * d.y + pz * d.z));
  return Math.hypot(px - d.x * s, py - d.y * s, pz - d.z * s);
}

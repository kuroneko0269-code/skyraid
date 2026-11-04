// チュートリアルの課題（9-5c）の判定に使う姿勢の読み方（Three.js 非依存）: 機首の上下・バンク・方位・機首から見た角度
import { LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP } from '../../flight/flight-model';
import { inverseRotateVec3, rotateVec3, vec3, type Quat, type Vec3 } from '../../flight/math';

const DEG = 180 / Math.PI;
const f = vec3();
const r = vec3();
const u = vec3();
const l = vec3();

export interface Attitude {
  /** 機首の上下（度。上が正） */
  pitchDeg: number;
  /** バンク（度。右が正） */
  bankDeg: number;
  /** 方位（度。-Z から右回り） */
  headingDeg: number;
  /** 機体の上の向きの y（背面で負） */
  upY: number;
}

export function readAttitude(out: Attitude, q: Readonly<Quat>): Attitude {
  rotateVec3(f, q, LOCAL_FORWARD);
  rotateVec3(r, q, LOCAL_RIGHT);
  rotateVec3(u, q, LOCAL_UP);
  out.pitchDeg = Math.asin(Math.max(-1, Math.min(1, f.y))) * DEG;
  out.bankDeg = Math.atan2(-r.y, u.y) * DEG;
  out.headingDeg =
    Math.abs(f.x) + Math.abs(f.z) < 1e-6 ? out.headingDeg : Math.atan2(f.x, -f.z) * DEG;
  out.upY = u.y;
  return out;
}

export function createAttitude(): Attitude {
  return { pitchDeg: 0, bankDeg: 0, headingDeg: 0, upY: 1 };
}

/** 2 つの方位の差（0〜180 度） */
export function headingDiff(a: number, b: number): number {
  const d = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return d;
}

export interface NoseView {
  angle: number;
  distance: number;
}

/** 機首から見た点の角度（度）と距離（m）を out に書く */
export function noseAngle(
  out: NoseView,
  from: Readonly<Vec3>,
  q: Readonly<Quat>,
  to: Readonly<Vec3>,
): NoseView {
  l.x = to.x - from.x;
  l.y = to.y - from.y;
  l.z = to.z - from.z;
  const distance = Math.hypot(l.x, l.y, l.z);
  inverseRotateVec3(l, q, l);
  out.angle = Math.atan2(Math.hypot(l.x, l.y), -l.z) * DEG;
  out.distance = distance;
  return out;
}

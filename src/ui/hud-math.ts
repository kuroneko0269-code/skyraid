// HUD の表示値の計算（DOM・Three.js 非依存。tests/hud.test.ts でテスト）
import { rotateVec3, type Quat, type Vec3 } from '../flight/math';
import { LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP } from '../flight/flight-model';

const RAD_TO_DEG = 180 / Math.PI;

/** 機体の姿勢（度）。pitch は機首上げが正、roll は右バンクが正（±180）、heading は -Z から右回り 0〜360 */
export interface Attitude {
  pitch: number;
  roll: number;
  heading: number;
}

const forward: Vec3 = { x: 0, y: 0, z: 0 };
const up: Vec3 = { x: 0, y: 0, z: 0 };
const right: Vec3 = { x: 0, y: 0, z: 0 };

/** 姿勢クォータニオンから pitch / roll / heading を求めて out に書く */
export function attitudeFromQuat(out: Attitude, q: Readonly<Quat>): Attitude {
  rotateVec3(forward, q, LOCAL_FORWARD);
  rotateVec3(up, q, LOCAL_UP);
  rotateVec3(right, q, LOCAL_RIGHT);
  out.pitch = Math.asin(Math.max(-1, Math.min(1, forward.y))) * RAD_TO_DEG;
  // 右翼が下がる（right.y < 0）と右バンク。背面では ±180 付近
  out.roll = Math.atan2(-right.y, up.y) * RAD_TO_DEG;
  const heading = Math.atan2(forward.x, -forward.z) * RAD_TO_DEG;
  out.heading = heading < 0 ? heading + 360 : heading;
  return out;
}

/** 速度表示（m/s 相当の値をそのまま整数に丸める） */
export function formatSpeed(speed: number): string {
  return String(Math.max(0, Math.round(speed)));
}

/** 高度表示（海面基準、m を整数に丸める。-0 を出さない） */
export function formatAltitude(altitude: number): string {
  const v = Math.round(altitude);
  return String(v === 0 ? 0 : v);
}

/** 地面接近警告: 地表との距離が threshold 未満 */
export function isGroundWarning(altitudeAboveGround: number, threshold: number): boolean {
  return altitudeAboveGround < threshold;
}

/** 失速表示: 失速の度合いが threshold を超える */
export function isStallWarning(stall: number, threshold: number): boolean {
  return stall > threshold;
}

/**
 * ピッチラダーの変換。ラダー全体を (水平線が機体のピッチ分ずれた位置で) ロールと逆に回す。
 * CSS では `rotate(rotateDeg) translateY(offsetPx)` の順に書く（回したあとの縦軸に沿ってずらす）
 */
export interface LadderTransform {
  /** 画面の回転（度、CSS の rotate と同じ時計回りが正） */
  rotateDeg: number;
  /** 回転後の縦方向のずれ（px、下が正） */
  offsetPx: number;
}

export function ladderTransform(
  out: LadderTransform,
  pitchDeg: number,
  rollDeg: number,
  pxPerDeg: number,
): LadderTransform {
  // 右バンクで水平線は反時計回りに傾き、機首上げで水平線は下へ下がる
  out.rotateDeg = rollDeg === 0 ? 0 : -rollDeg;
  out.offsetPx = pitchDeg * pxPerDeg;
  return out;
}

/** ラダーの目盛りの角度（-90〜+90、stepDeg ごと） */
export function ladderRungs(stepDeg: number): number[] {
  const rungs: number[] = [];
  for (let deg = -90; deg <= 90; deg += stepDeg) rungs.push(deg);
  return rungs;
}

/** 目盛りの位置（ラダーの中心＝0°からの縦のずれ、px、下が正） */
export function rungOffsetPx(deg: number, pxPerDeg: number): number {
  return deg === 0 ? 0 : -deg * pxPerDeg;
}

/** レーダー上の点。x 右・y 下が正で、円の半径を 1 とする */
export interface RadarPoint {
  x: number;
  y: number;
  /** 範囲外で円の縁に寄せたか */
  clamped: boolean;
}

/**
 * 機首方向が上のレーダー（heading-up）での目標の位置。
 * heading は -Z から右回り（度）。範囲外の目標は向きを保ったまま縁に置く
 */
export function radarPoint(
  out: RadarPoint,
  selfX: number,
  selfZ: number,
  headingDeg: number,
  targetX: number,
  targetZ: number,
  rangeM: number,
): RadarPoint {
  const h = headingDeg / RAD_TO_DEG;
  const dx = targetX - selfX;
  const dz = targetZ - selfZ;
  // 機首方向 f = (sin h, -cos h)、右 r = (cos h, sin h)（x, z）
  const along = dx * Math.sin(h) - dz * Math.cos(h);
  const across = dx * Math.cos(h) + dz * Math.sin(h);
  let x = across / rangeM;
  let y = -along / rangeM;
  const len = Math.hypot(x, y);
  out.clamped = len > 1;
  if (out.clamped) {
    x /= len;
    y /= len;
  }
  out.x = x;
  out.y = y;
  return out;
}

/** 値が epsilon 以上変わったか（前回値が未設定の NaN なら常に true） */
export function changed(prev: number, next: number, epsilon: number): boolean {
  return Number.isNaN(prev) || Math.abs(next - prev) >= epsilon;
}

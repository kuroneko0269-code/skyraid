// フォトモード（7-A）の軌道カメラ（Three.js 非依存）: 機体中心の方位・仰角・距離・注視点のずらし・画角・ロール。
// 角度は機首の向きの水平の枠（機体のバンク・ピッチによらず地平線は水平）で測る。描画への適用は src/render/photo/
import { PHOTO_ORBIT, PHOTO_PRESETS, type PhotoPreset } from '../data/photo';
import type { Vec3 } from '../flight/math';

export interface PhotoOrbitState {
  /** 方位（度。0 = 機首の正面、90 = 右の真横、180 = 真後ろ） */
  azimuth: number;
  /** 仰角（度。正 = 上から） */
  elevation: number;
  /** 注視点からカメラまでの距離（m） */
  distance: number;
  /** 画角（度） */
  fov: number;
  /** ロール（度） */
  roll: number;
  /** 注視点のずらし（m。機首の向きの水平の枠: x 右・y 上・z 前） */
  pan: Vec3;
}

/** 機首の向き（水平の単位ベクトル。ワールドの x・z） */
export interface Heading {
  x: number;
  z: number;
}

export interface OrbitPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

const DEG = Math.PI / 180;

function clampTo(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** -180〜180 に収める */
export function wrapDegrees(d: number): number {
  const w = (((d + 180) % 360) + 360) % 360;
  return w - 180;
}

export function createOrbit(): PhotoOrbitState {
  const i = PHOTO_ORBIT.initial;
  return {
    azimuth: i.azimuth,
    elevation: i.elevation,
    distance: i.distance,
    fov: i.fov,
    roll: 0,
    pan: { x: 0, y: 0, z: 0 },
  };
}

/** 各値を範囲に収める（方位は −180〜180 に回す） */
export function clampOrbit(s: PhotoOrbitState): PhotoOrbitState {
  const c = PHOTO_ORBIT;
  s.azimuth = wrapDegrees(s.azimuth);
  s.elevation = clampTo(s.elevation, -c.maxElevation, c.maxElevation);
  s.distance = clampTo(s.distance, c.minDistance, c.maxDistance);
  s.fov = clampTo(s.fov, c.minFov, c.maxFov);
  s.roll = clampTo(s.roll, -c.maxRoll, c.maxRoll);
  const p = s.pan;
  const len = Math.hypot(p.x, p.y, p.z);
  if (len > c.maxPan) {
    const k = c.maxPan / len;
    p.x *= k;
    p.y *= k;
    p.z *= k;
  }
  return s;
}

/** プリセットの角度にする（ロールは 0） */
export function applyPreset(s: PhotoOrbitState, preset: PhotoPreset): PhotoOrbitState {
  s.azimuth = preset.azimuth;
  s.elevation = preset.elevation;
  s.distance = preset.distance;
  s.fov = preset.fov;
  s.roll = 0;
  s.pan.x = preset.pan.x;
  s.pan.y = preset.pan.y;
  s.pan.z = preset.pan.z;
  return clampOrbit(s);
}

export function findPreset(id: string): PhotoPreset | null {
  return PHOTO_PRESETS.find((p) => p.id === id) ?? null;
}

/** ドラッグで回す（px）。右へドラッグでカメラが機体の左へ回り込み、下へドラッグで上から見る */
export function rotateOrbit(s: PhotoOrbitState, dx: number, dy: number): PhotoOrbitState {
  const k = PHOTO_ORBIT.rotatePerPixel;
  s.azimuth += dx * k;
  s.elevation += dy * k;
  return clampOrbit(s);
}

/** 距離を factor 倍にする（ピンチ・ホイール） */
export function zoomOrbit(s: PhotoOrbitState, factor: number): PhotoOrbitState {
  if (Number.isFinite(factor) && factor > 0) s.distance *= factor;
  return clampOrbit(s);
}

/** ホイールの deltaY（下へ回すと正）から距離の倍率 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.pow(PHOTO_ORBIT.zoomBase, deltaY / 100);
}

/** カメラから注視点への向き（ワールド）と、画面の右・上 */
function viewBasis(s: Readonly<PhotoOrbitState>, h: Readonly<Heading>) {
  const az = s.azimuth * DEG;
  const el = s.elevation * DEG;
  // 右 = 前 × 上（右手系: 前 (0,0,-1) → 右 (1,0,0)）
  const rx = -h.z;
  const rz = h.x;
  const ca = Math.cos(az) * Math.cos(el);
  const sa = Math.sin(az) * Math.cos(el);
  // 注視点からカメラへの向き
  const ox = rx * sa + h.x * ca;
  const oy = Math.sin(el);
  const oz = rz * sa + h.z * ca;
  // 画面の右 = 視線 × 上（視線 = −o）、画面の上 = 右 × 視線
  let sx = oz;
  let sz = -ox;
  const sl = Math.hypot(sx, sz) || 1;
  sx /= sl;
  sz /= sl;
  // 画面の上 = 画面の右 (sx, 0, sz) × 視線 (−ox, −oy, −oz)
  const up = { x: sz * oy, y: sx * oz - sz * ox, z: -sx * oy };
  return { o: { x: ox, y: oy, z: oz }, r: { x: rx, z: rz }, sr: { x: sx, z: sz }, up };
}

/**
 * 画面の上で注視点をずらす（2 本指ドラッグ・右ドラッグ。px）。指の動きに画面が付いてくる向き。
 * viewportHeight は画面の高さ（px）
 */
export function panOrbit(
  s: PhotoOrbitState,
  dx: number,
  dy: number,
  viewportHeight: number,
  h: Readonly<Heading>,
): PhotoOrbitState {
  const b = viewBasis(s, h);
  const k = (s.distance * PHOTO_ORBIT.panPerScreen) / Math.max(1, viewportHeight);
  // ワールドでの移動: 右へドラッグ → 注視点は左へ、下へドラッグ → 注視点は上へ
  const wx = -b.sr.x * dx * k + b.up.x * dy * k;
  const wy = b.up.y * dy * k;
  const wz = -b.sr.z * dx * k + b.up.z * dy * k;
  // 機首の向きの水平の枠へ
  s.pan.x += wx * b.r.x + wz * b.r.z;
  s.pan.y += wy;
  s.pan.z += wx * h.x + wz * h.z;
  return clampOrbit(s);
}

/**
 * カメラの位置と注視点。center は機体の位置。カメラは機体から maxDistance 以内（向きは保ったまま近づける）、
 * 地面・海面（groundAt）から groundClearance 以上
 */
export function orbitPose(
  s: Readonly<PhotoOrbitState>,
  center: Readonly<Vec3>,
  h: Readonly<Heading>,
  groundAt: (x: number, z: number) => number,
  out: { position: Vec3; target: Vec3 },
): OrbitPose {
  const c = PHOTO_ORBIT;
  const b = viewBasis(s, h);
  const p = s.pan;
  // 注視点 = 機体 + ずらし（ワールド）
  const px = b.r.x * p.x + h.x * p.z;
  const py = p.y;
  const pz = b.r.z * p.x + h.z * p.z;
  // |ずらし + 向き × t| ≤ maxDistance になる最大の t
  const dot = px * b.o.x + py * b.o.y + pz * b.o.z;
  const pp = px * px + py * py + pz * pz;
  const tMax = -dot + Math.sqrt(Math.max(0, dot * dot - (pp - c.maxDistance * c.maxDistance)));
  const t = Math.min(s.distance, Math.max(0, tMax));
  out.target.x = center.x + px;
  out.target.y = center.y + py;
  out.target.z = center.z + pz;
  out.position.x = out.target.x + b.o.x * t;
  out.position.y = out.target.y + b.o.y * t;
  out.position.z = out.target.z + b.o.z * t;
  const floor = groundAt(out.position.x, out.position.z) + c.groundClearance;
  if (out.position.y < floor) out.position.y = floor;
  return out;
}

/** 機体の前（ワールド）から機首の向き（水平の単位ベクトル）。真上・真下を向いているときは prev のまま */
export function headingFrom(forward: Readonly<Vec3>, prev: Heading): Heading {
  const len = Math.hypot(forward.x, forward.z);
  if (len > 1e-3) {
    prev.x = forward.x / len;
    prev.z = forward.z / len;
  }
  return prev;
}

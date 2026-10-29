// 三人称カメラの計算（Three.js 非依存）。chase-camera.ts が結果を PerspectiveCamera に反映する
import type { CameraConfig, CameraCurvePoint } from '../data/camera';
import {
  approachFactor,
  clamp,
  copyVec3,
  crossVec3,
  rotateVec3,
  vec3,
  type Quat,
  type Vec3,
} from '../flight/math';
import { CameraShake } from './camera-shake';
import { SpringVec3 } from './spring';

/** chase: スプリングで追う追従カメラ / fixed: 機体に固定した後方カメラ */
export const CAMERA_MODES = ['chase', 'fixed'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

/** カメラが追う対象。機体の描画用（補間済み）の姿勢と飛行状態 */
export interface CameraTarget {
  readonly position: Readonly<Vec3>;
  readonly orientation: Readonly<Quat>;
  readonly speed: number;
  readonly afterburnerActive: boolean;
  /** 失速の度合い（0〜1） */
  readonly stall: number;
  /** 機体ローカルの角速度（rad/s）。x = ピッチ、y = ヨー */
  readonly angularRate: Readonly<Vec3>;
}

export interface CameraPose {
  readonly position: Vec3;
  readonly lookAt: Vec3;
  /** 視線と直交する単位ベクトル */
  readonly up: Vec3;
  /** 垂直画角（度） */
  fov: number;
}

/** 速度→値の折れ線を線形補間する。範囲外は端の値 */
export function sampleCurve(curve: readonly CameraCurvePoint[], speed: number): number {
  const first = curve[0];
  if (!first) return 0;
  if (speed <= first.speed) return first.value;
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i];
    const a = curve[i - 1];
    if (!a || !b) break;
    if (speed <= b.speed)
      return a.value + ((b.value - a.value) * (speed - a.speed)) / (b.speed - a.speed);
  }
  const last = curve[curve.length - 1];
  return last ? last.value : first.value;
}

/** 追従カメラの距離（m）。afterburner はアフターバーナーの上乗せ量（0〜1） */
export function chaseDistance(
  cfg: CameraConfig['chase'],
  speed: number,
  afterburner: number,
): number {
  return sampleCurve(cfg.distanceCurve, speed) + cfg.afterburnerDistanceBoost * afterburner;
}

/** 追従カメラの垂直画角（度） */
export function chaseFov(cfg: CameraConfig['chase'], speed: number, afterburner: number): number {
  return sampleCurve(cfg.fovCurve, speed) + cfg.afterburnerFovBoost * afterburner;
}

const LOCAL_UP: Readonly<Vec3> = { x: 0, y: 1, z: 0 };

export class CameraRig {
  mode: CameraMode = 'chase';
  readonly pose: CameraPose = { position: vec3(), lookAt: vec3(), up: vec3(0, 1, 0), fov: 60 };

  // 位置・注視点は「機体位置からのオフセット」にスプリングを掛ける。
  // ワールド座標で追うと速度に比例して遅れ（250 m/s で数十 m）、距離が速度の折れ線から外れるため
  private readonly positionSpring = new SpringVec3();
  private readonly lookSpring = new SpringVec3();
  private readonly upSpring = new SpringVec3();
  private readonly shake: CameraShake;
  private afterburnerBlend = 0;
  private initialized = false;

  private readonly local = vec3();
  private readonly offset = vec3();
  private readonly lookOffset = vec3();
  private readonly targetUp = vec3();
  private readonly view = vec3();
  private readonly right = vec3();

  constructor(private readonly config: CameraConfig) {
    this.shake = new CameraShake(config.shake);
  }

  /** 次の update で補間せずに目標位置へ移す（リセット時・モード切替時） */
  snap(): void {
    this.initialized = false;
  }

  toggleMode(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? 'chase';
    this.snap();
    return this.mode;
  }

  /** 地面衝突などの揺れを加える */
  addImpact(strength = 1): void {
    this.shake.addImpact(strength);
  }

  /** dt は実時間（秒）。groundHeight はカメラ直下の地面の高さ（m） */
  update(target: CameraTarget, groundHeight: number, dt: number): Readonly<CameraPose> {
    const cfg = this.config;
    const step = clamp(dt, 0, cfg.maxDt);
    const pose = this.pose;
    const q = target.orientation;
    rotateVec3(this.targetUp, q, LOCAL_UP);

    if (this.mode === 'chase') {
      this.updateChase(target, step);
    } else {
      const f = cfg.fixed;
      this.setLocal(0, f.height, f.distance);
      rotateVec3(this.offset, q, this.local);
      this.setLocal(0, 0, -f.lookAhead);
      rotateVec3(this.lookOffset, q, this.local);
      copyVec3(pose.up, this.targetUp);
      pose.fov = sampleCurve(cfg.chase.fovCurve, target.speed);
    }
    addTo(pose.position, target.position, this.offset);
    addTo(pose.lookAt, target.position, this.lookOffset);
    this.orthogonalizeUp();

    // 揺れは位置と注視点を同じだけずらす（画面全体が揺れる）
    this.shake.update(target.stall, step);
    const s = this.shake.offset;
    crossVec3(this.right, this.view, pose.up);
    addShake(pose.position, this.right, pose.up, s.x, s.y);
    addShake(pose.lookAt, this.right, pose.up, s.x, s.y);

    // 地面に潜らない。視線が変わるので up を取り直す
    const minY = groundHeight + cfg.minHeightAboveGround;
    if (pose.position.y < minY) {
      pose.position.y = minY;
      this.orthogonalizeUp();
    }
    return pose;
  }

  private updateChase(target: CameraTarget, dt: number): void {
    const cfg = this.config.chase;
    const q = target.orientation;
    const abTarget = target.afterburnerActive ? 1 : 0;
    if (!this.initialized) {
      this.afterburnerBlend = abTarget;
    } else {
      this.afterburnerBlend +=
        (abTarget - this.afterburnerBlend) * approachFactor(cfg.afterburnerResponse, dt);
    }
    const distance = chaseDistance(cfg, target.speed, this.afterburnerBlend);
    this.pose.fov = chaseFov(cfg, target.speed, this.afterburnerBlend);

    this.setLocal(0, cfg.height, distance);
    rotateVec3(this.offset, q, this.local);

    // 旋回中は機首が向かっていく側へ注視点をずらす（ω × 前方 = (-ωy, ωx, 0)）
    const w = target.angularRate;
    let leadX = -w.y * cfg.turnLeadGain;
    let leadY = w.x * cfg.turnLeadGain;
    const lead = Math.hypot(leadX, leadY);
    if (lead > cfg.turnLeadMax) {
      leadX *= cfg.turnLeadMax / lead;
      leadY *= cfg.turnLeadMax / lead;
    }
    this.setLocal(leadX, leadY, -cfg.lookAhead);
    rotateVec3(this.lookOffset, q, this.local);

    if (!this.initialized) {
      this.positionSpring.reset(this.offset);
      this.lookSpring.reset(this.lookOffset);
      this.upSpring.reset(this.targetUp);
      this.initialized = true;
    } else {
      this.positionSpring.update(this.offset, cfg.positionStiffness, dt);
      this.lookSpring.update(this.lookOffset, cfg.lookStiffness, dt);
      this.upSpring.update(this.targetUp, cfg.upStiffness, dt);
    }
    copyVec3(this.offset, this.positionSpring.value);
    copyVec3(this.lookOffset, this.lookSpring.value);
    copyVec3(this.pose.up, this.upSpring.value);
  }

  /** pose.up を視線に直交する単位ベクトルにする。潰れたら機体の上方向を使う（宙返り・背面対策） */
  private orthogonalizeUp(): void {
    const pose = this.pose;
    const v = this.view;
    v.x = pose.lookAt.x - pose.position.x;
    v.y = pose.lookAt.y - pose.position.y;
    v.z = pose.lookAt.z - pose.position.z;
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-6) return;
    v.x /= len;
    v.y /= len;
    v.z /= len;
    if (!projectOut(pose.up, v)) {
      // 機体の上方向は機首（≒視線）と直交するので、ここで潰れることはまずない
      copyVec3(pose.up, this.targetUp);
      projectOut(pose.up, v);
    }
  }

  private setLocal(x: number, y: number, z: number): void {
    this.local.x = x;
    this.local.y = y;
    this.local.z = z;
  }
}

function addTo(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): void {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
}

function addShake(p: Vec3, right: Readonly<Vec3>, up: Readonly<Vec3>, x: number, y: number): void {
  p.x += right.x * x + up.x * y;
  p.y += right.y * x + up.y * y;
  p.z += right.z * x + up.z * y;
}

/** u から単位ベクトル n の成分を除いて正規化する。潰れて正規化できなければ false */
function projectOut(u: Vec3, n: Readonly<Vec3>): boolean {
  const d = u.x * n.x + u.y * n.y + u.z * n.z;
  const x = u.x - d * n.x;
  const y = u.y - d * n.y;
  const z = u.z - d * n.z;
  const len = Math.hypot(x, y, z);
  if (len < 1e-3) return false;
  u.x = x / len;
  u.y = y / len;
  u.z = z / len;
  return true;
}

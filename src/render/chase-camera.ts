import type { Object3D, PerspectiveCamera } from 'three';
import { CAMERA_CONFIG, type CameraConfig } from '../data/camera';
import type { Vec3 } from '../flight/math';
import { CameraRig, type CameraMode, type CameraPose, type CameraTarget } from './camera-rig';

/** 機体メッシュ（補間済みの姿勢）以外にカメラが使う飛行状態 */
export interface CameraFlightState {
  readonly speed: number;
  readonly afterburnerActive: boolean;
  readonly stall: number;
  readonly angularRate: Readonly<Vec3>;
}

/**
 * 三人称カメラ。計算は CameraRig（Three.js 非依存）に任せ、結果を PerspectiveCamera に反映する
 */
export class ChaseCamera {
  private readonly rig: CameraRig;
  private readonly target: { -readonly [K in keyof CameraTarget]: CameraTarget[K] } = {
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    speed: 0,
    afterburnerActive: false,
    stall: 0,
    angularRate: { x: 0, y: 0, z: 0 },
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    config: CameraConfig = CAMERA_CONFIG,
  ) {
    this.rig = new CameraRig(config);
  }

  get mode(): CameraMode {
    return this.rig.mode;
  }

  /**
   * dt は実時間（秒）。描画フレームごとに呼ぶ。groundHeight はカメラ直下の地面の高さ。
   * focus はターゲットカメラ（4-12）で寄せる対象の位置（null なら寄せない）
   */
  update(
    mesh: Object3D,
    flight: CameraFlightState,
    groundHeight: number,
    dt: number,
    focus: Readonly<Vec3> | null = null,
  ): void {
    const t = this.setTarget(mesh, flight);
    this.rig.focus = focus;
    this.rig.aspect = this.camera.aspect;
    this.apply(this.rig.update(t, groundHeight, dt));
  }

  /**
   * リスポーン（撃墜・墜落。4-12b）: 機体の新しい位置・姿勢へ今すぐ移す。スプリング・ターゲットカメラの寄せ・揺れを捨て、
   * 次の描画を待たずにカメラを置く（次のフレームの地面の高さもカメラの新しい位置で引ける）。
   * mesh は新しい位置に置き直した機体、groundAt は地面の高さ
   */
  snapTo(
    mesh: Object3D,
    flight: CameraFlightState,
    groundAt: (x: number, z: number) => number,
  ): void {
    const t = this.setTarget(mesh, flight);
    this.rig.aspect = this.camera.aspect;
    // カメラは機体の数十 m 後ろなので、機体の真下の地面の高さで足りる
    this.apply(this.rig.snapTo(t, groundAt(mesh.position.x, mesh.position.z)));
  }

  private setTarget(mesh: Object3D, flight: CameraFlightState): CameraTarget {
    const t = this.target;
    t.position = mesh.position;
    t.orientation = mesh.quaternion;
    t.speed = flight.speed;
    t.afterburnerActive = flight.afterburnerActive;
    t.stall = flight.stall;
    t.angularRate = flight.angularRate;
    return t;
  }

  private apply(pose: Readonly<CameraPose>): void {
    const camera = this.camera;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
    if (Math.abs(camera.fov - pose.fov) > 1e-3) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  toggleMode(): CameraMode {
    return this.rig.toggleMode();
  }

  /** 地面衝突などの揺れを加える */
  addImpact(strength = 1): void {
    this.rig.addImpact(strength);
  }

  /** 次の update で補間せずに目標位置へ移す（リセット時） */
  snap(): void {
    this.rig.snap();
  }
}

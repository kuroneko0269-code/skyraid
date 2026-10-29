import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { CHASE_CAMERA_CONFIG } from '../data/scene';

/**
 * 機体の後方上空から lerp で追う最小限のカメラ。
 * 上方向も機体に合わせて追従させるので、宙返りで画面が反転しない
 */
export class ChaseCamera {
  private readonly desired = new Vector3();
  private readonly lookTarget = new Vector3();
  private readonly targetUp = new Vector3();
  private initialized = false;

  constructor(private readonly camera: PerspectiveCamera) {}

  /** dt は実時間（秒）。描画フレームごとに呼ぶ */
  update(target: Object3D, dt: number): void {
    const cfg = CHASE_CAMERA_CONFIG;
    this.desired.set(cfg.offset.x, cfg.offset.y, cfg.offset.z).applyQuaternion(target.quaternion);
    this.desired.add(target.position);
    this.targetUp.set(0, 1, 0).applyQuaternion(target.quaternion);

    if (!this.initialized) {
      this.camera.position.copy(this.desired);
      this.camera.up.copy(this.targetUp);
      this.initialized = true;
    } else {
      this.camera.position.lerp(this.desired, 1 - Math.exp(-cfg.positionRate * dt));
      this.camera.up.lerp(this.targetUp, 1 - Math.exp(-cfg.upRate * dt)).normalize();
    }

    this.lookTarget.set(0, 0, -cfg.lookAhead).applyQuaternion(target.quaternion);
    this.lookTarget.add(target.position);
    this.camera.lookAt(this.lookTarget);
  }

  /** 次の update で補間せずに目標位置へ移す（リセット時） */
  snap(): void {
    this.initialized = false;
  }
}

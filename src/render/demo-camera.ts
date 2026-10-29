import type { PerspectiveCamera } from 'three';
import { SCREEN_CONFIG, type DemoCameraConfig } from '../data/screens';
import type { Vec3 } from '../flight/math';

export interface DemoCameraPose {
  readonly position: Vec3;
  readonly lookAt: Vec3;
}

/**
 * 周回開始から t 秒後のデモカメラの位置と注視点（Three.js 非依存）。
 * 上から見て反時計回り（角度 0 が +Z 側）。out を書き換えて返す
 */
export function demoOrbitPose(
  config: DemoCameraConfig,
  t: number,
  out: DemoCameraPose,
): DemoCameraPose {
  const angle = (config.startAngleDeg * Math.PI) / 180 + (2 * Math.PI * t) / config.periodSeconds;
  out.position.x = config.centerX + config.radius * Math.sin(angle);
  out.position.y = config.height;
  out.position.z = config.centerZ + config.radius * Math.cos(angle);
  out.lookAt.x = config.centerX;
  out.lookAt.y = config.lookAtHeight;
  out.lookAt.z = config.centerZ;
  return out;
}

/** タイトル画面の背景用カメラ。表示している間だけ時間を進める */
export class DemoCamera {
  private time = 0;
  private readonly pose: DemoCameraPose = {
    position: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 0, z: 0 },
  };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly config: DemoCameraConfig = SCREEN_CONFIG.demoCamera,
  ) {}

  /** dt は実時間（秒）。描画フレームごとに呼ぶ */
  update(dt: number): void {
    // 長時間放置しても角度の精度が落ちないよう 1 周で巻き戻す
    this.time = (this.time + dt) % this.config.periodSeconds;
    const { position: p, lookAt: l } = demoOrbitPose(this.config, this.time, this.pose);
    const camera = this.camera;
    camera.position.set(p.x, p.y, p.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(l.x, l.y, l.z);
    if (Math.abs(camera.fov - this.config.fov) > 1e-3) {
      camera.fov = this.config.fov;
      camera.updateProjectionMatrix();
    }
  }
}

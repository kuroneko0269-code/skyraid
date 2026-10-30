import type { Group, PerspectiveCamera, Scene } from 'three';
import type { AircraftShape } from '../data/aircraft';
import { HANGAR_CONFIG } from '../data/hangar';
import { createPlaceholderAircraft, rebuildPlaceholderAircraft } from './aircraft-mesh';
import { setShadowFlags } from './lighting';

const DEG = Math.PI / 180;

/**
 * ハンガー（3-3）の機体の展示: 実際のシーン（空・海・島）の上空に選んだ機体のプレースホルダーを置き、
 * ゆっくり回す。表示中はカメラを展示の前に固定する（飛行・デモカメラとは別）
 */
export class HangarStage {
  readonly mesh: Group;
  private yaw = 0;
  private shape: Readonly<AircraftShape> | null = null;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly config = HANGAR_CONFIG.stage,
  ) {
    this.mesh = createPlaceholderAircraft();
    const p = config.position;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.visible = false;
    setShadowFlags(this.mesh, true, true);
    scene.add(this.mesh);
  }

  /** 展示する機体の形（同じ形なら作り直さない） */
  setShape(shape: Readonly<AircraftShape>): void {
    if (this.shape === shape) return;
    this.shape = shape;
    rebuildPlaceholderAircraft(this.mesh, shape);
    setShadowFlags(this.mesh, true, true);
  }

  setShown(shown: boolean): void {
    this.mesh.visible = shown;
  }

  /** 表示中に描画フレームごとに呼ぶ。dt は実時間（秒） */
  update(dt: number): void {
    const c = this.config;
    this.yaw = (this.yaw + c.yawDegPerSecond * DEG * dt) % (Math.PI * 2);
    this.mesh.rotation.set(c.pitchDeg * DEG, this.yaw, 0, 'YXZ');
    const p = c.position;
    const o = c.cameraOffset;
    const camera = this.camera;
    // 縦長の画面では横幅に収まるよう離れる（minAspect より細いと、その比で遠ざける）
    const k = Math.max(1, c.minAspect / camera.aspect);
    camera.position.set(p.x + o.x * k, p.y + o.y * k, p.z + o.z * k);
    camera.up.set(0, 1, 0);
    camera.lookAt(p.x, p.y + c.lookAtHeight, p.z);
    if (Math.abs(camera.fov - c.fov) > 1e-3) {
      camera.fov = c.fov;
      camera.updateProjectionMatrix();
    }
  }
}

import {
  CircleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { AircraftModel } from '../data/aircraft';
import { HANGAR_CONFIG } from '../data/hangar';
import { AircraftObject } from './aircraft-model/aircraft-object';

const DEG = Math.PI / 180;

/**
 * ハンガー（3-3）の機体の展示: 実際のシーン（空・海・島）の上空に選んだ機体のモデル（4-3。画質によらず細かい方）を
 * 置き、ゆっくり回す。下に影を受ける半透明の円の床。表示中はカメラを展示の前に固定する（飛行・デモカメラとは別）
 */
export class HangarStage {
  /** 展示の位置（床と機体）。影の中心にも使う */
  readonly mesh = new Group();
  private readonly model = new AircraftObject();
  private yaw = 0;

  constructor(
    scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly config = HANGAR_CONFIG.stage,
  ) {
    const p = config.position;
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.visible = false;
    const f = config.floor;
    const floor = new Mesh(
      new CircleGeometry(f.radius, 48).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({
        color: f.color,
        roughness: f.roughness,
        metalness: 0,
        transparent: true,
        opacity: f.opacity,
        depthWrite: false,
      }),
    );
    floor.position.y = -f.depth;
    floor.receiveShadow = true;
    this.mesh.add(this.model.group, floor);
    scene.add(this.mesh);
  }

  /** 展示する機体とパイロンの数（ミサイルの積める数。同じなら作り直さない） */
  setModel(model: AircraftModel, missiles: number): void {
    this.model.build(model.shape, 'high', missiles);
  }

  setShown(shown: boolean): void {
    this.mesh.visible = shown;
  }

  /** 表示中に描画フレームごとに呼ぶ。dt は実時間（秒） */
  update(dt: number): void {
    const c = this.config;
    this.yaw = (this.yaw + c.yawDegPerSecond * DEG * dt) % (Math.PI * 2);
    // 床は水平のまま、機体だけ回して機首を少し上げる
    this.model.group.rotation.set(c.pitchDeg * DEG, this.yaw, 0, 'YXZ');
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

// フォトモード（7-A）のカメラと表示の切替: 軌道カメラ（core/photo-orbit.ts）の結果をカメラに入れ、
// 機体・敵と怪獣・エフェクトを Three.js の layers で隠す（影・被写界深度の奥行きからも消える）。
// 出るときはカメラ（位置・向き・画角）と layers を入る前へ戻す
import { Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { headingFrom, orbitPose, type Heading, type PhotoOrbitState } from '../../core/photo-orbit';

export type PhotoLayer = 'aircraft' | 'enemies' | 'effects';

const LAYER_INDEX: Readonly<Record<PhotoLayer, number>> = { aircraft: 1, enemies: 2, effects: 3 };
const DEG = Math.PI / 180;

export class PhotoCamera {
  private readonly savedPosition = new Vector3();
  private readonly savedQuaternion = new Quaternion();
  private readonly savedUp = new Vector3();
  private savedFov = 60;
  private active = false;
  private readonly heading: Heading = { x: 0, z: -1 };
  private readonly forward = new Vector3();
  private readonly pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly groups: Readonly<Record<PhotoLayer, readonly Object3D[]>>,
  ) {}

  /** 入る: カメラを覚え、表示の切替の組をそれぞれの layer へ */
  enter(): void {
    if (this.active) return;
    this.active = true;
    const c = this.camera;
    this.savedPosition.copy(c.position);
    this.savedQuaternion.copy(c.quaternion);
    this.savedUp.copy(c.up);
    this.savedFov = c.fov;
    for (const key of Object.keys(LAYER_INDEX) as PhotoLayer[]) {
      setLayer(this.groups[key], LAYER_INDEX[key]);
      c.layers.enable(LAYER_INDEX[key]);
    }
  }

  /** 出る: カメラと layers を戻す */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    const c = this.camera;
    c.position.copy(this.savedPosition);
    c.quaternion.copy(this.savedQuaternion);
    c.up.copy(this.savedUp);
    c.fov = this.savedFov;
    c.updateProjectionMatrix();
    for (const key of Object.keys(LAYER_INDEX) as PhotoLayer[]) {
      setLayer(this.groups[key], 0);
      c.layers.disable(LAYER_INDEX[key]);
    }
  }

  setVisible(layer: PhotoLayer, visible: boolean): void {
    if (visible) this.camera.layers.enable(LAYER_INDEX[layer]);
    else this.camera.layers.disable(LAYER_INDEX[layer]);
  }

  /** 機首の向き（水平）。軌道の角度の基準 */
  headingOf(mesh: Object3D): Readonly<Heading> {
    this.forward.set(0, 0, -1).applyQuaternion(mesh.quaternion);
    return headingFrom(this.forward, this.heading);
  }

  /** 描画フレームごと: 機体（mesh）を中心に軌道の位置へ置く。戻り値はカメラから注視点までの距離（m） */
  update(
    orbit: Readonly<PhotoOrbitState>,
    mesh: Object3D,
    groundAt: (x: number, z: number) => number,
  ): number {
    const c = this.camera;
    const h = this.headingOf(mesh);
    const p = orbitPose(orbit, mesh.position, h, groundAt, this.pose);
    c.position.set(p.position.x, p.position.y, p.position.z);
    c.up.set(0, 1, 0);
    c.lookAt(p.target.x, p.target.y, p.target.z);
    if (orbit.roll !== 0) c.rotateZ(-orbit.roll * DEG);
    if (Math.abs(c.fov - orbit.fov) > 1e-3) {
      c.fov = orbit.fov;
      c.updateProjectionMatrix();
    }
    return Math.hypot(
      p.target.x - p.position.x,
      p.target.y - p.position.y,
      p.target.z - p.position.z,
    );
  }
}

function setLayer(roots: readonly Object3D[], layer: number): void {
  for (const root of roots) {
    root.traverse((o) => {
      o.layers.set(layer);
    });
  }
}

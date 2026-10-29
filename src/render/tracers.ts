// 曳光弾の描画。全弾を InstancedMesh 1 つ（1 draw call）で、前後に長い発光する（光の影響を受けない）棒として描く
import {
  BoxGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Bullet } from '../combat/gun';
import type { Pool } from '../combat/pool';
import { TRACER_CONFIG } from '../data/effects';
import type { Vec3 } from '../flight/math';

const AXIS_Z = new Vector3(0, 0, 1);
const dir = new Vector3();
const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const matrix = new Matrix4();

export class TracerRenderer {
  readonly mesh: InstancedMesh;

  constructor(capacity: number) {
    const material = new MeshBasicMaterial({
      color: TRACER_CONFIG.color,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 弾を前ステップ位置と現在位置の間（alpha）に描く。棒の先端が弾の位置 */
  update(bullets: Pool<Bullet>, alpha: number, camera: Readonly<Vec3>): void {
    const c = TRACER_CONFIG;
    const n = Math.min(bullets.count, this.mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const b = bullets.get(i);
      const hx = b.px + (b.x - b.px) * alpha;
      const hy = b.py + (b.y - b.py) * alpha;
      const hz = b.pz + (b.z - b.pz) * alpha;
      dir.set(b.vx, b.vy, b.vz).normalize();
      // 撃った直後は機体にめり込まないよう、飛んだ距離までの長さにする
      const len = Math.max(0.5, Math.min(c.length, b.traveled));
      pos.set(hx - (dir.x * len) / 2, hy - (dir.y * len) / 2, hz - (dir.z * len) / 2);
      const d = Math.hypot(hx - camera.x, hy - camera.y, hz - camera.z);
      const w = Math.max(c.width, d * c.widthPerMeter);
      quat.setFromUnitVectors(AXIS_Z, dir);
      scale.set(w, w, len);
      this.mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

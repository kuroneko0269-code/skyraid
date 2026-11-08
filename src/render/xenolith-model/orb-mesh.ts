// 10-5b: UFO ゼノリスの光の弾の見た目: 丸みのある光の粒（ゴウライの弾と同じ細長い八面体を、長さと太さを同じにして使う）を
// InstancedMesh 1 つでまとめて描く（何発でも描画は 1 回、出ていないときは 0）。位置は前のステップとの間を alpha で補間（速度から戻す）
import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Shot } from '../../ai/raid-kit/shots';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { buildShotGeometry } from '../gourai-model/shot-mesh';

const M = XENOLITH_MODEL_CONFIG;
const STEP = 1 / 60;
const matrix = new Matrix4();
const quat = new Quaternion();
const scale = new Vector3();
const p = new Vector3();
const UP = new Vector3(0, 1, 0);
export class OrbMesh {
  readonly mesh: InstancedMesh;
  readonly triangles = 8;
  private time = 0;

  constructor(cap: number) {
    const mat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true });
    this.mesh = new InstancedMesh(buildShotGeometry(M.colors.orb, M.colors.orbCore), mat, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 飛んでいる弾を並べる（show が false なら隠す）。粒はゆっくり回って瞬く */
  update(shots: readonly Shot[], alpha: number, dt: number, show: boolean): void {
    this.time += dt;
    this.mesh.count = 0;
    if (show)
      for (const s of shots) {
        if (!s.active) continue;
        const back = (1 - alpha) * STEP;
        const r = M.orb.radius * (0.9 + 0.1 * Math.sin(this.time * 20 + s.turret));
        quat.setFromAxisAngle(UP, this.time * 4 + s.turret);
        scale.set(r, r, r * 1.3);
        p.set(
          s.position.x - s.velocity.x * back,
          s.position.y - s.velocity.y * back,
          s.position.z - s.velocity.z * back,
        );
        matrix.compose(p, quat, scale);
        this.mesh.setMatrixAt(this.mesh.count++, matrix);
      }
    this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// リング（2-4）の描画: 次に通るリングは発光する黄色の Mesh、その先の数個は水色の InstancedMesh（draw call 2）。
// 通過済みのリングと、リングの目標が進行中でないときは描かない
import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import { RING_CONFIG } from '../data/rings';
import type { Ring } from '../missions/objectives/ring';
import type { RingPassObjective } from '../missions/objectives';
import { createEmissiveMaterial } from './materials';

const Z_AXIS = new Vector3(0, 0, 1);
const pos = new Vector3();
const normal = new Vector3();
const quat = new Quaternion();
const scale = new Vector3();
const matrix = new Matrix4();

export class RingView {
  private readonly next: Mesh;
  private readonly others: InstancedMesh;

  constructor(scene: Scene) {
    const c = RING_CONFIG;
    // 輪の太さは半径 1 の輪に対する比で作り、大きさは scale で決める
    const geometry = new TorusGeometry(1, c.tube / c.radius, 10, 48);
    this.next = new Mesh(geometry, createEmissiveMaterial(c.nextColor, c.nextIntensity));
    this.next.visible = false;
    const material = new MeshStandardMaterial({
      color: c.otherColor,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.75,
    });
    this.others = new InstancedMesh(geometry, material, c.visibleAhead);
    this.others.instanceMatrix.setUsage(DynamicDrawUsage);
    this.others.frustumCulled = false;
    this.others.count = 0;
    this.others.visible = false;
    scene.add(this.next, this.others);
  }

  /** 描画フレームごとに呼ぶ。rings は進行中のリングの目標（なければ null） */
  update(rings: RingPassObjective | null): void {
    const next = rings?.next ?? null;
    this.next.visible = next !== null;
    if (next) {
      ringMatrix(next, matrix).decompose(this.next.position, this.next.quaternion, this.next.scale);
    }
    let n = 0;
    if (rings) {
      const from = rings.current + 1;
      const to = Math.min(rings.rings.length, from + RING_CONFIG.visibleAhead);
      for (let i = from; i < to; i++) {
        const r = rings.rings[i];
        if (r) this.others.setMatrixAt(n++, ringMatrix(r, matrix));
      }
    }
    this.others.count = n;
    this.others.visible = n > 0;
    this.others.instanceMatrix.needsUpdate = true;
  }
}

/** リングの位置・向き（輪の面の法線を +Z から回す）・大きさ */
function ringMatrix(r: Ring, out: Matrix4): Matrix4 {
  pos.set(r.position.x, r.position.y, r.position.z);
  normal.set(r.normal.x, r.normal.y, r.normal.z);
  quat.setFromUnitVectors(Z_AXIS, normal);
  scale.setScalar(RING_CONFIG.radius);
  return out.compose(pos, quat, scale);
}

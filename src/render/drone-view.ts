// 周回ドローン（2-2）の描画。箱を組み合わせた形を 1 つのジオメトリにまとめ、InstancedMesh 1 つ（1 draw call）で描く
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRONE_CONFIG } from '../data/targets';
import type { TargetDrone } from '../entities/target-drone';

const GRAVITY = 9.8;
const WHITE = new Color(0xffffff);
const color = new Color();
const matrix = new Matrix4();
const forward = new Vector3();
const inward = new Vector3();
const up = new Vector3();
const right = new Vector3();
const back = new Vector3();

/** 胴体・主翼・水平尾翼・垂直尾翼（前方 -Z、翼幅 9m・長さ 7m） */
function createDroneGeometry(): BufferGeometry {
  const parts = [
    new BoxGeometry(1.2, 1, 7),
    new BoxGeometry(9, 0.2, 2).translate(0, 0, 0.3),
    new BoxGeometry(3.2, 0.15, 1).translate(0, 0, 3),
    new BoxGeometry(0.15, 1.6, 1.2).translate(0, 0.8, 3),
  ];
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

export class DroneView {
  private readonly mesh: InstancedMesh;
  private readonly baseColor = new Color(DRONE_CONFIG.color);

  constructor(
    scene: Scene,
    private readonly drones: readonly TargetDrone[],
  ) {
    const material = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
    this.mesh = new InstancedMesh(createDroneGeometry(), material, Math.max(1, drones.length));
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < drones.length; i++) this.mesh.setColorAt(i, this.baseColor);
    scene.add(this.mesh);
  }

  /** 位置を補間し、進行方向を向けて円の内側へバンクさせる（tan φ = v² / (r g)） */
  update(alpha: number): void {
    let n = 0;
    for (const d of this.drones) {
      if (!d.active) continue;
      const p = d.position;
      const q = d.prevPosition;
      const x = q.x + (p.x - q.x) * alpha;
      const y = q.y + (p.y - q.y) * alpha;
      const z = q.z + (p.z - q.z) * alpha;
      forward.set(d.velocity.x, d.velocity.y, d.velocity.z).normalize();
      inward.set(d.orbit.centerX - x, 0, d.orbit.centerZ - z).normalize();
      const v = DRONE_CONFIG.speed;
      const bank = Math.atan((v * v) / (d.orbit.radius * GRAVITY));
      up.set(0, Math.cos(bank), 0).addScaledVector(inward, Math.sin(bank));
      right.crossVectors(forward, up).normalize();
      back.copy(forward).negate();
      matrix.makeBasis(right, up, back).setPosition(x, y, z);
      this.mesh.setMatrixAt(n, matrix);
      const flash = d.flashTimer > 0 ? 0.75 : 0;
      this.mesh.setColorAt(n, color.copy(this.baseColor).lerp(WHITE, flash));
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

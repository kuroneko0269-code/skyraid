// ミサイルの煙の尾。煙の玉を InstancedMesh 1 つ（1 draw call）で描く。玉はプールで使い回す
import {
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { Pool } from '../combat/pool';
import { SMOKE_CONFIG } from '../data/effects';

interface Puff {
  x: number;
  y: number;
  z: number;
  age: number;
}

const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const matrix = new Matrix4();

export class SmokeTrail {
  readonly mesh: InstancedMesh;
  readonly pool: Pool<Puff>;

  constructor(capacity: number = SMOKE_CONFIG.max) {
    const c = SMOKE_CONFIG;
    const material = new MeshStandardMaterial({
      color: c.color,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: c.opacity,
      depthWrite: false,
    });
    this.pool = new Pool(capacity, () => ({ x: 0, y: 0, z: 0, age: 0 }));
    this.mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 玉を 1 つ出す。満杯なら何もしない */
  emit(x: number, y: number, z: number): void {
    const p = this.pool.acquire();
    if (!p) return;
    p.x = x;
    p.y = y;
    p.z = z;
    p.age = 0;
  }

  clear(): void {
    this.pool.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** dt 秒進めてインスタンス行列を書く（dt = 0 のポーズ中も描画は更新する） */
  update(dt: number): void {
    const c = SMOKE_CONFIG;
    const pool = this.pool;
    for (let i = pool.count - 1; i >= 0; i--) {
      const p = pool.get(i);
      p.age += dt;
      if (p.age >= c.life) pool.release(i);
    }
    for (let i = 0; i < pool.count; i++) {
      const p = pool.get(i);
      const t = p.age / c.life;
      let size = c.startSize + (c.endSize - c.startSize) * Math.sqrt(t);
      const remain = 1 - t;
      if (remain < c.fadeFraction) size *= remain / c.fadeFraction;
      pos.set(p.x, p.y, p.z);
      scale.set(size, size, size);
      this.mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
    }
    this.mesh.count = pool.count;
    this.mesh.visible = pool.count > 0;
    if (pool.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

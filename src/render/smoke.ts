// ミサイルの煙の尾。煙の玉を InstancedMesh 1 つ（1 draw call）で描く。玉はプールで使い回す。
// 飛行機雲（4-3）も色・寿命・大きさを変えて同じものを使う
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
import { emissiveScale } from './materials';

interface Puff {
  x: number;
  y: number;
  z: number;
  age: number;
  /** 伸ばす向き（style.length があるとき。単位ベクトル） */
  dx: number;
  dy: number;
  dz: number;
}

/** 玉の出し方（SMOKE_CONFIG と同じ形） */
export interface SmokeStyle {
  readonly max: number;
  readonly life: number;
  readonly startSize: number;
  readonly endSize: number;
  readonly fadeFraction: number;
  readonly color: number;
  readonly opacity: number;
  /** 光に依らない明るさ（露出後。日陰側が灰色にならないように。省略は 0） */
  readonly emissive?: number;
  /** 玉を emit の向きへこの長さ（m）だけ伸ばす（飛行機雲を少ない玉で筋に見せる。省略は球のまま） */
  readonly length?: number;
}

const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const IDENTITY = new Quaternion();
const AXIS_Z = new Vector3(0, 0, 1);
const dir = new Vector3();
const matrix = new Matrix4();

export class SmokeTrail {
  readonly mesh: InstancedMesh;
  readonly pool: Pool<Puff>;

  constructor(private readonly style: SmokeStyle = SMOKE_CONFIG) {
    const c = style;
    const capacity = c.max;
    const material = new MeshStandardMaterial({
      color: c.color,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: c.opacity,
      depthWrite: false,
      emissive: c.color,
      emissiveIntensity: emissiveScale(c.emissive ?? 0),
    });
    this.pool = new Pool(capacity, () => ({ x: 0, y: 0, z: 0, age: 0, dx: 0, dy: 0, dz: 1 }));
    this.mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 玉を 1 つ出す。満杯なら何もしない。(dx, dy, dz) は style.length で伸ばす向き（単位ベクトル） */
  emit(x: number, y: number, z: number, dx = 0, dy = 0, dz = 1): void {
    const p = this.pool.acquire();
    if (!p) return;
    p.x = x;
    p.y = y;
    p.z = z;
    p.age = 0;
    p.dx = dx;
    p.dy = dy;
    p.dz = dz;
  }

  clear(): void {
    this.pool.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** dt 秒進めてインスタンス行列を書く（dt = 0 のポーズ中も描画は更新する） */
  update(dt: number): void {
    const c = this.style;
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
      const length = c.length;
      if (length === undefined) {
        scale.set(size, size, size);
        this.mesh.setMatrixAt(i, matrix.compose(pos, IDENTITY, scale));
      } else {
        // 玉の z を向きへ回して伸ばす
        quat.setFromUnitVectors(AXIS_Z, dir.set(p.dx, p.dy, p.dz));
        scale.set(size, size, size + length);
        this.mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
      }
    }
    this.mesh.count = pool.count;
    this.mesh.visible = pool.count > 0;
    if (pool.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

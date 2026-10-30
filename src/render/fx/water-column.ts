// 墜落の水柱（4-4）: 海面への墜落で白い円柱が立ち上がり（0.35 秒）、太りながら崩れて薄くなる（1.5 秒）。
// 全部の水柱を InstancedMesh 1 つ（1 draw call）。根元のしぶきは SmokeField に白い玉で出す
import {
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type InstancedBufferAttribute,
} from 'three';
import { Pool } from '../../combat/pool';
import { WATER_COLUMN_CONFIG as W } from '../../data/fx';
import { addAlphaAttribute, useInstanceAlpha } from './instance-alpha';
import type { SmokeField } from './smoke-field';

interface Column {
  x: number;
  y: number;
  z: number;
  age: number;
  size: number;
}

/** 水柱の形（寿命の割合 t → 高さ・半径の倍率と不透明度）。テストあり */
export function waterColumnShape(t: number): { height: number; radius: number; alpha: number } {
  const rise = W.riseTime / W.life;
  if (t <= rise) {
    const k = t / rise;
    // 立ち上がりは最初が速い
    return { height: 1 - (1 - k) * (1 - k), radius: 0.7 + 0.3 * k, alpha: 1 };
  }
  const k = Math.min(1, (t - rise) / (1 - rise));
  return {
    height: 1 + (W.endHeightScale - 1) * k * k,
    radius: 1 + (W.spreadScale - 1) * k,
    alpha: 1 - k,
  };
}

const IDENTITY = new Quaternion();
const pos = new Vector3();
const scale = new Vector3();
const matrix = new Matrix4();

export class WaterColumns {
  readonly mesh: InstancedMesh;
  private readonly pool = new Pool<Column>(W.max, () => ({ x: 0, y: 0, z: 0, age: 0, size: 1 }));
  private readonly alpha: InstancedBufferAttribute;

  constructor(private readonly smoke: SmokeField) {
    const material = useInstanceAlpha(
      new MeshStandardMaterial({
        color: W.color,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        depthWrite: false,
      }),
    );
    // 上が少し細い筒（底は海面の下なので閉じない）。原点を底に
    const geometry = new CylinderGeometry(0.75, 1, 1, 16, 1, true).translate(0, 0.5, 0);
    this.mesh = new InstancedMesh(geometry, material, W.max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new Color(0xffffff));
    this.alpha = addAlphaAttribute(this.mesh, W.max);
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 海面の (x, y, z) に水柱を立てる。size は規模の倍率（機体 1） */
  spawn(x: number, y: number, z: number, size = 1): void {
    const c = this.pool.acquire();
    if (c) {
      c.x = x;
      c.y = y;
      c.z = z;
      c.age = 0;
      c.size = size;
    }
    const s = W.spray;
    for (let i = 0; i < W.sprayPuffs; i++) {
      const a = (i / W.sprayPuffs) * Math.PI * 2 + Math.random() * 0.5;
      const v = 10 + Math.random() * 8;
      this.smoke.emit(
        x + Math.cos(a) * W.radius,
        y + 2,
        z + Math.sin(a) * W.radius,
        s,
        Math.cos(a) * v,
        6 + Math.random() * 6,
        Math.sin(a) * v,
        0,
      );
    }
  }

  clear(): void {
    this.pool.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  update(dt: number): void {
    const pool = this.pool;
    for (let i = pool.count - 1; i >= 0; i--) {
      const c = pool.get(i);
      c.age += dt;
      if (c.age >= W.life) pool.release(i);
    }
    const alpha = this.alpha.array;
    for (let i = 0; i < pool.count; i++) {
      const c = pool.get(i);
      const s = waterColumnShape(c.age / W.life);
      const r = W.radius * s.radius * c.size;
      pos.set(c.x, c.y, c.z);
      scale.set(r, Math.max(0.01, W.height * s.height * c.size), r);
      this.mesh.setMatrixAt(i, matrix.compose(pos, IDENTITY, scale));
      alpha[i] = W.opacity * s.alpha;
    }
    this.mesh.count = pool.count;
    this.mesh.visible = pool.count > 0;
    if (pool.count === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

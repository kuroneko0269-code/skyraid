// 煙の玉の場（4-4）: 爆発の黒煙・敵機の損傷の煙・フラックの黒い玉・水柱のしぶき・ミサイル発射の白煙を
// InstancedMesh 1 つ（1 draw call）で描く。玉ごとに色・不透明度・大きさ・寿命・初速が違ってよい。
// 玉は上がりながら風下へ流れ、初速は空気抵抗で止まる。最初の fadeIn 秒で濃くなり、寿命の最後で薄くなって消える
import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type InstancedBufferAttribute,
} from 'three';
import { Pool } from '../../combat/pool';
import { SMOKE_FIELD_CONFIG as C } from '../../data/fx';
import { WIND_CONFIG } from '../../data/wind';
import { addAlphaAttribute, useInstanceAlpha } from './instance-alpha';

/** 玉の出し方 */
export interface PuffStyle {
  readonly life: number;
  /** 直径（出た直後 → 寿命の終わり） */
  readonly start: number;
  readonly end: number;
  readonly opacity: number;
  readonly color: number;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rise: number;
  /** 負の間はまだ見えない（爆発の火球が黒煙に変わるまで待つ） */
  age: number;
  life: number;
  s0: number;
  s1: number;
  opacity: number;
  color: Color;
}

const IDENTITY = new Quaternion();
const pos = new Vector3();
const scale = new Vector3();
const matrix = new Matrix4();
const DEG = Math.PI / 180;

export class SmokeField {
  readonly mesh: InstancedMesh;
  private readonly pool: Pool<Puff>;
  private readonly alpha: InstancedBufferAttribute;
  private readonly driftX: number;
  private readonly driftZ: number;

  constructor(capacity: number = C.max) {
    const material = useInstanceAlpha(
      new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new Color(C.color));
    this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
    this.alpha = addAlphaAttribute(this.mesh, capacity);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.pool = new Pool(capacity, () => ({
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rise: 0,
      age: 0,
      life: 1,
      s0: 1,
      s1: 1,
      opacity: 1,
      color: new Color(),
    }));
    const a = WIND_CONFIG.direction * DEG;
    this.driftX = Math.cos(a) * C.driftSpeed;
    this.driftZ = Math.sin(a) * C.driftSpeed;
  }

  get count(): number {
    return this.pool.count;
  }

  /**
   * 玉を 1 つ出す。満杯なら何もしない。(vx, vy, vz) は初速（空気抵抗で止まる）、rise は上がり続ける速さ、
   * delay 秒たってから見え始める
   */
  emit(
    x: number,
    y: number,
    z: number,
    style: PuffStyle,
    vx = 0,
    vy = 0,
    vz = 0,
    rise = 0,
    delay = 0,
  ): void {
    const p = this.pool.acquire();
    if (!p) return;
    const k = 1 + (Math.random() * 2 - 1) * C.sizeJitter;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.rise = rise;
    p.age = -delay;
    p.life = style.life;
    p.s0 = style.start * k;
    p.s1 = style.end * k;
    p.opacity = style.opacity;
    p.color.setHex(style.color);
  }

  clear(): void {
    this.pool.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** dt 秒進めて描く（dt = 0 のポーズ中も描画は更新する） */
  update(dt: number): void {
    const pool = this.pool;
    const damp = Math.exp(-C.drag * dt);
    for (let i = pool.count - 1; i >= 0; i--) {
      const p = pool.get(i);
      p.age += dt;
      if (p.age >= p.life) {
        pool.release(i);
        continue;
      }
      if (p.age < 0) continue;
      p.x += (p.vx + this.driftX) * dt;
      p.y += (p.vy + p.rise) * dt;
      p.z += (p.vz + this.driftZ) * dt;
      p.vx *= damp;
      p.vy *= damp;
      p.vz *= damp;
    }
    const alpha = this.alpha.array;
    for (let i = 0; i < pool.count; i++) {
      const p = pool.get(i);
      const t = Math.max(0, p.age) / p.life;
      const size = p.age < 0 ? 0 : p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      pos.set(p.x, p.y, p.z);
      scale.set(size, size, size);
      this.mesh.setMatrixAt(i, matrix.compose(pos, IDENTITY, scale));
      this.mesh.setColorAt(i, p.color);
      alpha[i] = p.opacity * puffFade(p.age, p.life, C.fadeIn, C.fadeFraction);
    }
    this.mesh.count = pool.count;
    this.mesh.visible = pool.count > 0;
    if (pool.count === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

/** 玉の濃さ（0〜1）: 最初の fadeIn 秒で 0 → 1、寿命の最後の fadeFraction で 1 → 0。age が負なら 0 */
export function puffFade(age: number, life: number, fadeIn: number, fadeFraction: number): number {
  if (age < 0 || age >= life) return 0;
  const inK = fadeIn > 0 ? Math.min(1, age / fadeIn) : 1;
  const remain = 1 - age / life;
  const outK = Math.min(1, remain / fadeFraction);
  return inK * outK;
}

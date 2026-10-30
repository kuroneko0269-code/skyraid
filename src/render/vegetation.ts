// 木（4-6）。森の層に決定的に撒いた木を、近く（600m 以内）は InstancedMesh の簡易な木（円錐 2 段 + 円柱。
// 風でわずかに揺れる）、遠くはカメラを向く十字ビルボード（縦の板 + 水平の板）で描く。draw call は合わせて 2。
// 4-7: 画質「中」以上は 3〜5 本の束で置き、遠くのビルボードは束ごとに 1 枚（輪郭は木の数だけの山）。
// 色は地形の森の層と同じく彩度を下げ、遠くの森が地面の森の色と揃うようにする。
// 4-9: 近くの木は少しずつずらした円錐 3 段 + 丸めた頂点（vegetation-near.ts）を木ごとに向きを回して置き、
// 遠景は手続き生成の丸い樹冠（vegetation-crowns.ts）。どちらも空の環境マップ（4-10）を受ける。
// 影は落とさない・受けない。衝突判定はしない。配置は terrain-gen/forest.ts、遠景は vegetation-billboard.ts、
// 数値は src/data/vegetation.ts
import {
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Texture,
  Vector3,
} from 'three';
import { VEGETATION_CONFIG } from '../data/vegetation';
import type { Vec3 } from '../flight/math';
import { placeTrees, type TreePlacement } from './terrain-gen/forest';
import {
  createBillboardGeometry,
  createBillboardMaterial,
  treeShape,
} from './vegetation-billboard';
import { createNearMaterial, createTreeGeometry, treeColor } from './vegetation-near';
import type { HeightFn } from './terrain-height';

/** seed（0〜1）と番号 k から 0〜1 の擬似乱数（木ごとの個体差用。葉と幹で別の値を取る） */
function seedHash(seed: number, k: number): number {
  const h = Math.imul((seed * 16777216) | 0, 374761393) ^ Math.imul(k + 1, 668265263);
  const m = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((m ^ (m >>> 16)) >>> 0) / 4294967296;
}

/**
 * 木ごとの葉・幹の色の倍率（4-8）。基準の色を色相 ±hueDeg 度・明るさ ±lightness ずらした色 ÷ 基準の色。
 * 戻り値はどちらも木 1 本につき RGB の 3 つ
 */
export function treeTints(
  seeds: Readonly<Float32Array>,
  count: number,
): {
  foliage: Float32Array;
  trunk: Float32Array;
} {
  const c = VEGETATION_CONFIG.colors;
  const variation = c.nearVariation;
  const bases = [treeColor(c.foliage), treeColor(c.trunk)];
  const out = [new Float32Array(count * 3), new Float32Array(count * 3)];
  const varied = new Color();
  for (let t = 0; t < count; t++) {
    const seed = seeds[t] ?? 0;
    for (let part = 0; part < 2; part++) {
      const base = bases[part] ?? varied;
      const target = out[part] ?? new Float32Array(0);
      const hue = ((seedHash(seed, part * 2) * 2 - 1) * variation.hueDeg) / 360;
      const light = 1 + (seedHash(seed, part * 2 + 1) * 2 - 1) * variation.lightness;
      varied.copy(base).offsetHSL(hue, 0, 0);
      target[t * 3] = (varied.r / Math.max(base.r, 1e-4)) * light;
      target[t * 3 + 1] = (varied.g / Math.max(base.g, 1e-4)) * light;
      target[t * 3 + 2] = (varied.b / Math.max(base.b, 1e-4)) * light;
    }
  }
  return { foliage: out[0] ?? new Float32Array(0), trunk: out[1] ?? new Float32Array(0) };
}

export class Vegetation {
  readonly object = new Group();
  private readonly time = { value: 0 };
  private readonly nearMaterial = createNearMaterial(this.time);
  private readonly billboardMaterial = createBillboardMaterial();
  private readonly treeGeometry = createTreeGeometry();
  private trees: TreePlacement | null = null;
  private tints: { foliage: Float32Array; trunk: Float32Array } | null = null;
  private trunkColors: InstancedBufferAttribute | null = null;
  private requested = 0;
  private clumped = false;
  private near: InstancedMesh | null = null;
  private far: Mesh | null = null;
  private readonly lastCenter: Vec3 = { x: Infinity, y: 0, z: Infinity };
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();

  constructor(private readonly height: HeightFn) {
    this.object.name = 'vegetation';
  }

  /** 本数と束にするか（画質）。変わったときだけ撒き直す */
  setCount(count: number, clumped = false): void {
    if (this.trees && this.requested === count && this.clumped === clumped) return;
    this.requested = count;
    this.clumped = clumped;
    this.trees = placeTrees(this.height, count, undefined, undefined, clumped);
    this.rebuild(this.trees);
  }

  /** 空の環境マップ（4-10 の機体と同じもの。4-9）を近景・遠景の木に付ける */
  setEnvironment(texture: Texture): void {
    const intensity = VEGETATION_CONFIG.environment.intensity;
    for (const material of [this.nearMaterial, this.billboardMaterial]) {
      material.envMap = texture;
      material.envMapIntensity = intensity;
      material.needsUpdate = true;
    }
  }

  /** 撒いた木の数 */
  get count(): number {
    return this.trees?.count ?? 0;
  }

  /** 描画フレームごとに呼ぶ。time は秒（風の揺れ） */
  update(camera: Readonly<Vec3>, time: number): void {
    this.time.value = time;
    const dx = camera.x - this.lastCenter.x;
    const dz = camera.z - this.lastCenter.z;
    if (dx * dx + dz * dz < VEGETATION_CONFIG.nearRefresh ** 2) return;
    this.lastCenter.x = camera.x;
    this.lastCenter.z = camera.z;
    this.refreshNear(camera);
  }

  private rebuild(trees: TreePlacement): void {
    if (this.near) {
      this.object.remove(this.near);
      this.near.geometry.dispose();
      this.near.dispose();
    }
    if (this.far) {
      this.object.remove(this.far);
      this.far.geometry.dispose();
    }
    // 幹の個体差の色はインスタンスの属性を足すので、木の形のジオメトリは撒き直しごとに複製する
    const capacity = Math.max(1, trees.count);
    const geometry = this.treeGeometry.clone();
    this.trunkColors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    geometry.setAttribute('instanceTrunkColor', this.trunkColors);
    this.tints = treeTints(trees.seeds, trees.count);
    const near = new InstancedMesh(geometry, this.nearMaterial, capacity);
    near.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    near.count = 0;
    near.frustumCulled = false;
    const far = new Mesh(createBillboardGeometry(trees), this.billboardMaterial);
    far.frustumCulled = false;
    far.matrixAutoUpdate = false;
    this.near = near;
    this.far = far;
    this.object.add(near, far);
    this.lastCenter.x = Infinity;
  }

  /** カメラから nearDistance + nearRefresh 以内の木を InstancedMesh に詰め直す */
  private refreshNear(camera: Readonly<Vec3>): void {
    const near = this.near;
    const trees = this.trees;
    const tints = this.tints;
    const trunkColors = this.trunkColors;
    if (!near || !trees || !tints || !trunkColors) return;
    const v = VEGETATION_CONFIG;
    const range = v.nearDistance + v.nearRefresh;
    const r2 = range * range;
    const colors = near.instanceColor;
    let k = 0;
    for (let t = 0; t < trees.count; t++) {
      const x = trees.positions[t * 3] ?? 0;
      const z = trees.positions[t * 3 + 2] ?? 0;
      const dx = x - camera.x;
      const dz = z - camera.z;
      if (dx * dx + dz * dz > r2) continue;
      const seed = trees.seeds[t] ?? 0;
      const shape = treeShape(seed, trees.scales[t] ?? 1);
      const w = shape.width * shape.height;
      const h = shape.height + v.sink;
      // 4-9: 木ごとに向きを回す（段のずれが木ごとに違って見える）
      this.matrix
        .makeRotationY(seedHash(seed, 7) * Math.PI * 2)
        .scale(this.scale.set(w, h, w))
        .setPosition(x, (trees.positions[t * 3 + 1] ?? 0) - v.sink, z);
      near.setMatrixAt(k, this.matrix);
      const f3 = tints.foliage;
      const t3 = tints.trunk;
      colors?.setXYZ(k, f3[t * 3] ?? 1, f3[t * 3 + 1] ?? 1, f3[t * 3 + 2] ?? 1);
      trunkColors.setXYZ(k, t3[t * 3] ?? 1, t3[t * 3 + 1] ?? 1, t3[t * 3 + 2] ?? 1);
      k++;
    }
    near.count = k;
    near.instanceMatrix.needsUpdate = true;
    if (colors) colors.needsUpdate = true;
    trunkColors.needsUpdate = true;
  }
}

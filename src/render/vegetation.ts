// 木（4-6）。森の層に決定的に撒いた木を、近く（600m 以内）は InstancedMesh の簡易な木（円錐 2 段 + 円柱。
// 風でわずかに揺れる）、遠くはカメラを向く十字ビルボード（縦の板 + 水平の板）で描く。draw call は合わせて 2。
// 4-7: 画質「中」以上は 3〜5 本の束で置き、遠くのビルボードは束ごとに 1 枚（輪郭は木の数だけの山）。
// 色は地形の森の層と同じく彩度を下げ、遠くの森が地面の森の色と揃うようにする。
// 影は落とさない・受けない。衝突判定はしない。配置は terrain-gen/forest.ts、遠景は vegetation-billboard.ts、
// 数値は src/data/vegetation.ts
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VEGETATION_CONFIG } from '../data/vegetation';
import { WIND_CONFIG } from '../data/wind';
import type { Vec3 } from '../flight/math';
import { placeTrees, type TreePlacement } from './terrain-gen/forest';
import {
  createBillboardGeometry,
  createBillboardMaterial,
  treeShape,
} from './vegetation-billboard';
import type { HeightFn } from './terrain-height';
import { terrainLinear } from './terrain-layers-glsl';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** 葉・幹の色（地形の層と同じく彩度を下げた線形 RGB。4-7） */
function treeColor(hex: number): Color {
  const [r, g, b] = terrainLinear(hex);
  return new Color(r, g, b);
}

/**
 * 高さ 1・幅 1（半径 0.5）の木。y = 0 が根元。頂点カラーで幹と葉（下ほど暗い）を塗る。
 * treePart は幹 1・葉 0（幹と葉で別の個体差の色を掛けるため。4-8）
 */
function createTreeGeometry(): BufferGeometry {
  const c = VEGETATION_CONFIG.colors;
  const trunk = new CylinderGeometry(0.05, 0.07, 0.3, 5, 1, true).translate(0, 0.15, 0);
  const lower = new ConeGeometry(0.5, 0.62, 8, 1, true).translate(0, 0.18 + 0.31, 0);
  const upper = new ConeGeometry(0.36, 0.5, 8, 1, true).translate(0, 0.5 + 0.25, 0);
  const parts = [trunk, lower, upper].map((g) => g.toNonIndexed());
  const foliage = treeColor(c.foliage);
  const bark = treeColor(c.trunk);
  parts.forEach((g, index) => {
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const col = index === 0 ? bark : foliage;
      // 葉は下ほど暗い（枝の重なりの陰）
      const shade = index === 0 ? 1 : 0.55 + 0.6 * y;
      colors[v * 3] = col.r * shade;
      colors[v * 3 + 1] = col.g * shade;
      colors[v * 3 + 2] = col.b * shade;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    g.setAttribute(
      'treePart',
      new BufferAttribute(new Float32Array(pos.count).fill(index === 0 ? 1 : 0), 1),
    );
  });
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
}

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

function createNearMaterial(time: { value: number }): MeshLambertMaterial {
  const v = VEGETATION_CONFIG;
  const wind = (WIND_CONFIG.direction * Math.PI) / 180;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTreeTime;\nattribute float treePart;\nattribute vec3 instanceTrunkColor;',
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          // 個体差（4-8）: 葉は instanceColor、幹は instanceTrunkColor
          vColor.xyz = color.xyz * mix(instanceColor.xyz, instanceTrunkColor, treePart);
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          // 風の揺れ: 梢ほど大きく（position.y は高さに対する割合）。位相は木の位置で変える
          float swayPhase = dot(instanceMatrix[3].xz, vec2(0.071, 0.053));
          float sway = sin(uTreeTime * ${f(v.sway.speed)} + swayPhase)
            + 0.35 * sin(uTreeTime * ${f(v.sway.speed * 2.3)} + swayPhase * 1.7);
          float swayScale = ${f(v.sway.amplitude)} / max(length(instanceMatrix[0].xyz), 0.1);
          transformed.xz += vec2(${f(Math.cos(wind))}, ${f(Math.sin(wind))}) * sway * swayScale * position.y * position.y;
          // 遠景（ビルボード）の距離ではつぶす
          if (distance(instanceMatrix[3].xyz, cameraPosition) > ${f(v.nearDistance)}) transformed = vec3(0.0);
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'tree-near';
  return material;
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
      const shape = treeShape(trees.seeds[t] ?? 0);
      const w = shape.width * shape.height;
      const h = shape.height + v.sink;
      this.matrix.makeScale(w, h, w).setPosition(x, (trees.positions[t * 3 + 1] ?? 0) - v.sink, z);
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

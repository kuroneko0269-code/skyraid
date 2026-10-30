// 木（4-6）。森の層に決定的に撒いた木を、近く（600m 以内）は InstancedMesh の簡易な木（円錐 2 段 + 円柱。
// 風でわずかに揺れる）、遠くはカメラを向く十字ビルボード（縦の板 + 水平の板）で描く。draw call は合わせて 2。
// 影は落とさない・受けない。衝突判定はしない。配置は terrain-gen/forest.ts、数値は src/data/vegetation.ts
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
import type { HeightFn } from './terrain-height';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** 高さ 1・幅 1（半径 0.5）の木。y = 0 が根元。頂点カラーで幹と葉（下ほど暗い）を塗る */
function createTreeGeometry(): BufferGeometry {
  const c = VEGETATION_CONFIG.colors;
  const trunk = new CylinderGeometry(0.05, 0.07, 0.3, 5, 1, true).translate(0, 0.15, 0);
  const lower = new ConeGeometry(0.5, 0.62, 8, 1, true).translate(0, 0.18 + 0.31, 0);
  const upper = new ConeGeometry(0.36, 0.5, 8, 1, true).translate(0, 0.5 + 0.25, 0);
  const parts = [trunk, lower, upper].map((g) => g.toNonIndexed());
  const foliage = new Color(c.foliage);
  const bark = new Color(c.trunk);
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
  });
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** 木ごとの大きさと色のばらつき（seed 0〜1 から決定的に） */
function treeShape(seed: number): { height: number; width: number; tint: number } {
  const v = VEGETATION_CONFIG;
  const a = seed;
  const b = (seed * 7.31) % 1;
  const c = (seed * 13.7) % 1;
  return {
    height: v.height.min + (v.height.max - v.height.min) * a,
    width: 2 * (v.crownRatio.min + (v.crownRatio.max - v.crownRatio.min) * b),
    tint: 1 + (c * 2 - 1) * v.colors.lightness,
  };
}

/** 十字ビルボード（木 1 本 = 縦の板 + 水平の板、8 頂点）を全部の木で 1 つのジオメトリに */
function createBillboardGeometry(trees: TreePlacement): BufferGeometry {
  const v = VEGETATION_CONFIG;
  const n = trees.count;
  const centers = new Float32Array(n * 8 * 3);
  const corners = new Float32Array(n * 8 * 3);
  const sizes = new Float32Array(n * 8 * 2);
  const colors = new Float32Array(n * 8 * 3);
  const index = new Uint32Array(n * 12);
  const foliage = new Color(v.colors.foliageLight);
  // 縦の板（u: -1〜1、v: 0〜1）と水平の板（-1〜1 の正方形）
  const quad = [
    [-1, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [-1, 1, 0],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  for (let t = 0; t < n; t++) {
    const shape = treeShape(trees.seeds[t] ?? 0);
    const x = trees.positions[t * 3] ?? 0;
    const y = (trees.positions[t * 3 + 1] ?? 0) - v.sink;
    const z = trees.positions[t * 3 + 2] ?? 0;
    for (let k = 0; k < 8; k++) {
      const vi = t * 8 + k;
      centers.set([x, y, z], vi * 3);
      corners.set(quad[k] ?? [0, 0, 0], vi * 3);
      sizes[vi * 2] = (shape.width * shape.height) / 2;
      sizes[vi * 2 + 1] = shape.height + v.sink;
      colors.set([foliage.r * shape.tint, foliage.g * shape.tint, foliage.b * shape.tint], vi * 3);
    }
    const b = t * 8;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 6, b + 5, b + 4, b + 7, b + 6], t * 12);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(centers, 3));
  geometry.setAttribute('corner', new BufferAttribute(corners, 3));
  geometry.setAttribute('treeSize', new BufferAttribute(sizes, 2));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

function createNearMaterial(time: { value: number }): MeshLambertMaterial {
  const v = VEGETATION_CONFIG;
  const wind = (WIND_CONFIG.direction * Math.PI) / 180;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTreeTime;')
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

function createBillboardMaterial(): MeshLambertMaterial {
  const v = VEGETATION_CONFIG;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 corner;\nattribute vec2 treeSize;\nvarying vec3 vCorner;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        // 葉の塊として、上向きを少しカメラへ傾けた法線で照らす
        `vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + 0.35 * normalize(cameraPosition - position));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 toCam = cameraPosition - position;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
        vec3 transformed = corner.z < 0.5
          ? position + right * corner.x * treeSize.x + vec3(0.0, corner.y * treeSize.y, 0.0)
          : position + vec3(corner.x * treeSize.x * 0.9, treeSize.y * 0.42, corner.y * treeSize.x * 0.9);
        // 近く（InstancedMesh で描く距離）はつぶす
        if (length(toCam) < ${f(v.nearDistance)}) transformed = position;
        vCorner = corner;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCorner;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float edge = ${f(v.billboardEdgeNoise)};
        if (vCorner.z < 0.5) {
          // 針葉樹の輪郭: 下が広い三角形の縁をぎざぎざに。根元は細い幹
          float h = vCorner.y;
          float halfWidth = (1.0 - h) * (1.0 + edge * sin(h * 37.0 + vColor.r * 40.0)) * step(0.13, h);
          float trunk = step(abs(vCorner.x), 0.07) * step(h, 0.2);
          if (abs(vCorner.x) > halfWidth && trunk < 0.5) discard;
          diffuseColor.rgb *= mix(0.5, 1.1, h) * mix(1.0, 0.45, trunk);
        } else {
          float r = length(vCorner.xy);
          float a = atan(vCorner.y, vCorner.x);
          if (r > 0.8 + edge * sin(a * 7.0 + vColor.g * 50.0)) discard;
          diffuseColor.rgb *= 1.1 - 0.45 * r;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'tree-billboard';
  return material;
}

export class Vegetation {
  readonly object = new Group();
  private readonly time = { value: 0 };
  private readonly nearMaterial = createNearMaterial(this.time);
  private readonly billboardMaterial = createBillboardMaterial();
  private readonly treeGeometry = createTreeGeometry();
  private trees: TreePlacement | null = null;
  private near: InstancedMesh | null = null;
  private far: Mesh | null = null;
  private readonly lastCenter: Vec3 = { x: Infinity, y: 0, z: Infinity };
  private readonly matrix = new Matrix4();

  constructor(private readonly height: HeightFn) {
    this.object.name = 'vegetation';
  }

  /** 本数（画質）。多い本数の配置は少ない本数の配置を先頭に含むので、増えたときだけ撒き直す */
  setCount(count: number): void {
    if (this.trees?.count === count) return;
    this.trees = placeTrees(this.height, count);
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
      this.near.dispose();
    }
    if (this.far) {
      this.object.remove(this.far);
      this.far.geometry.dispose();
    }
    const near = new InstancedMesh(this.treeGeometry, this.nearMaterial, Math.max(1, trees.count));
    near.instanceColor = new InstancedBufferAttribute(
      new Float32Array(Math.max(1, trees.count) * 3),
      3,
    );
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
    if (!near || !trees) return;
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
      colors?.setXYZ(k, shape.tint, shape.tint * (0.97 + 0.06 * ((t * 0.618) % 1)), shape.tint);
      k++;
    }
    near.count = k;
    near.instanceMatrix.needsUpdate = true;
    if (colors) colors.needsUpdate = true;
  }
}

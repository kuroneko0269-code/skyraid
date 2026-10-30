// 木の遠景（4-6 → 4-7）: カメラを向く十字ビルボード（縦の板 + 水平の板）を全部の束で 1 つのジオメトリに。
// 画像を使わないので輪郭はフラグメントで捨てる。近景は src/render/vegetation.ts
import { BufferAttribute, BufferGeometry, MeshLambertMaterial } from 'three';
import { VEGETATION_CONFIG } from '../data/vegetation';
import type { TreePlacement } from './terrain-gen/forest';
import { terrainLinear } from './terrain-layers-glsl';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/** 木ごとの大きさと色のばらつき（seed 0〜1 から決定的に） */
export function treeShape(seed: number): { height: number; width: number; tint: number } {
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

/**
 * 十字ビルボード（束 1 つ = 縦の板 + 水平の板、8 頂点）を全部の束で 1 つのジオメトリに。
 * 束にしない配置（画質「低」）では木 1 本 = 束 1 つで 4-6 と同じ
 */
export function createBillboardGeometry(trees: TreePlacement): BufferGeometry {
  const v = VEGETATION_CONFIG;
  const clumps = trees.clumps;
  const n = clumps.count;
  const centers = new Float32Array(n * 8 * 3);
  const corners = new Float32Array(n * 8 * 3);
  const sizes = new Float32Array(n * 8 * 3);
  const colors = new Float32Array(n * 8 * 3);
  const index = new Uint32Array(n * 12);
  const [fr, fg, fb] = terrainLinear(v.colors.billboard);
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
    const shape = treeShape(clumps.seeds[t] ?? 0);
    const members = clumps.sizes[t] ?? 1;
    const x = clumps.positions[t * 3] ?? 0;
    const y = (clumps.positions[t * 3 + 1] ?? 0) - v.sink;
    const z = clumps.positions[t * 3 + 2] ?? 0;
    // 束は木の広がり + 樹冠の半径。木の数だけ山のある輪郭を描く（フラグメント）
    const crown = (shape.width * shape.height) / 2;
    const halfWidth = crown + (clumps.spreads[t] ?? 0);
    for (let k = 0; k < 8; k++) {
      const vi = t * 8 + k;
      centers.set([x, y, z], vi * 3);
      corners.set(quad[k] ?? [0, 0, 0], vi * 3);
      sizes[vi * 3] = halfWidth;
      sizes[vi * 3 + 1] = shape.height + v.sink;
      sizes[vi * 3 + 2] = members;
      colors.set([fr * shape.tint, fg * shape.tint, fb * shape.tint], vi * 3);
    }
    const b = t * 8;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 6, b + 5, b + 4, b + 7, b + 6], t * 12);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(centers, 3));
  geometry.setAttribute('corner', new BufferAttribute(corners, 3));
  geometry.setAttribute('treeSize', new BufferAttribute(sizes, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

export function createBillboardMaterial(): MeshLambertMaterial {
  const v = VEGETATION_CONFIG;
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 corner;\nattribute vec3 treeSize;\nvarying vec3 vCorner;\nvarying float vMembers;',
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
        vCorner = corner;
        vMembers = treeSize.z;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCorner;\nvarying float vMembers;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float edge = ${f(v.billboardEdgeNoise)};
        // 束（4-7）: 木の数が 2 本以上なら山を 3 つ（中央が高い）、1 本なら 1 つ
        bool clump = vMembers > 1.5;
        if (vCorner.z < 0.5) {
          // 針葉樹の輪郭: 下が広い三角形の縁をぎざぎざに。根元は細い幹
          float h = vCorner.y;
          float wobble = 1.0 + edge * sin(h * 37.0 + vColor.r * 40.0);
          float inside = (1.0 - h) * wobble * step(0.13, h) - abs(vCorner.x);
          if (clump) {
            // 3 つの山: 中心 x = -0.5 / 0 / 0.5、高さ 0.8 / 1 / 0.85、幅は束の半分
            inside = max(max(
              (0.8 - h) / 0.8 * 0.5 * wobble - abs(vCorner.x + 0.5),
              (1.0 - h) * 0.55 * wobble - abs(vCorner.x)),
              (0.85 - h) / 0.85 * 0.5 * wobble - abs(vCorner.x - 0.5)) * step(0.1, h);
          }
          float trunk = step(abs(vCorner.x), 0.07) * step(h, 0.2);
          if (inside < 0.0 && trunk < 0.5) discard;
          diffuseColor.rgb *= mix(0.5, 1.1, h) * mix(1.0, 0.45, trunk);
        } else {
          float r = length(vCorner.xy);
          float a = atan(vCorner.y, vCorner.x);
          float limit = 0.8 + edge * sin(a * 7.0 + vColor.g * 50.0);
          // 束は上から見て 3 つの円
          if (clump) {
            vec2 q = vCorner.xy;
            r = min(min(length(q - vec2(0.45, 0.0)), length(q - vec2(-0.25, 0.4))), length(q - vec2(-0.25, -0.4))) * 1.45;
          }
          if (r > limit) discard;
          diffuseColor.rgb *= 1.1 - 0.45 * r;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'tree-billboard';
  return material;
}

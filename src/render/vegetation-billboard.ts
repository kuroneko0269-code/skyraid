// 木の遠景（4-6 → 4-7 → 4-9）: カメラを向く十字ビルボード（縦の板 + 水平の板）を全部の束で 1 つのジオメトリに。
// 4-9: 輪郭は尖った三角形から、手続き生成の樹冠のテクスチャ（vegetation-crowns.ts。種類を束ごとにランダム）に。
// 光は空の環境マップ（4-10）も受ける（MeshStandardMaterial）。近景は src/render/vegetation.ts
import { BufferAttribute, BufferGeometry, MeshStandardMaterial } from 'three';
import { VEGETATION_CONFIG } from '../data/vegetation';
import type { TreePlacement } from './terrain-gen/forest';
import { terrainLinear } from './terrain-layers-glsl';
import { CROWN_LUMA_SCALE, CROWN_MARGIN, createCrownTexture } from './vegetation-crowns';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));

/**
 * 木ごとの大きさと色のばらつき（seed 0〜1 から決定的に）。scale は森の縁の高さの倍率（4-9。
 * TreePlacement.scales）。crown は遠景の樹冠の種類（0〜crowns.types − 1）
 */
export function treeShape(
  seed: number,
  scale = 1,
): { height: number; width: number; tint: number; crown: number } {
  const v = VEGETATION_CONFIG;
  const a = seed;
  const b = (seed * 7.31) % 1;
  const c = (seed * 13.7) % 1;
  const d = (seed * 29.3) % 1;
  return {
    height: v.height.mean * (1 + (a * 2 - 1) * v.height.variation) * scale,
    width: 2 * (v.crownRatio.min + (v.crownRatio.max - v.crownRatio.min) * b),
    tint: 1 + (c * 2 - 1) * v.colors.lightness,
    crown: Math.min(v.crowns.types - 1, Math.floor(d * v.crowns.types)),
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
    const shape = treeShape(clumps.seeds[t] ?? 0, clumps.scales[t] ?? 1);
    const members = clumps.sizes[t] ?? 1;
    const x = clumps.positions[t * 3] ?? 0;
    const y = (clumps.positions[t * 3 + 1] ?? 0) - v.sink;
    const z = clumps.positions[t * 3 + 2] ?? 0;
    // 束は木の広がり + 樹冠の半径
    const crown = (shape.width * shape.height) / 2;
    const halfWidth = crown + (clumps.spreads[t] ?? 0);
    for (let k = 0; k < 8; k++) {
      const vi = t * 8 + k;
      centers.set([x, y, z], vi * 3);
      corners.set(quad[k] ?? [0, 0, 0], vi * 3);
      sizes[vi * 3] = halfWidth;
      sizes[vi * 3 + 1] = shape.height + v.sink;
      // 束か（1 / 0）と樹冠の種類をまとめて 1 つの値に
      sizes[vi * 3 + 2] = (members > 1 ? 1 : 0) + shape.crown * 2;
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
  // 法線は頂点シェーダーで決めるが、属性がないと Three.js が平らな陰影（画面の微分の法線）に切り替え、
  // 縦の板がカメラの向きの法線で照らされて黒くなっていた（4-8 まで）。中身は使わない
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(n * 8 * 3), 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

export function createBillboardMaterial(): MeshStandardMaterial {
  const v = VEGETATION_CONFIG;
  const { types, tileSize } = v.crowns;
  const env = v.environment;
  const crowns = { value: createCrownTexture() };
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: env.roughness,
    metalness: 0,
  });
  // タイルの中の余白を除いた範囲（アトラスの UV）
  const cols = types + 1;
  const inner = (tileSize - CROWN_MARGIN * 2) / tileSize;
  const margin = CROWN_MARGIN / tileSize;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrowns = crowns;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 corner;\nattribute vec3 treeSize;\nvarying vec3 vCorner;\nvarying vec2 vTile;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        // 葉の塊として、上向きをカメラへ傾けた法線で照らす。4-9: 傾きを 0.35 → towardCamera に
        // （MeshStandardMaterial は法線と視線がほぼ直交すると拡散光が弱まる）
        `vec3 objectNormal = normalize(vec3(0.0, 1.0, 0.0) + ${f(v.environment.towardCamera)} * normalize(cameraPosition - position));`,
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
        // タイル（列, 行）: 縦は樹冠の種類の列、水平は最後の列。行は束か
        float clumpRow = mod(treeSize.z, 2.0);
        vTile = vec2(corner.z < 0.5 ? floor(treeSize.z * 0.5 + 0.1) : ${f(types)}, clumpRow);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uCrowns;\nvarying vec3 vCorner;\nvarying vec2 vTile;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // 樹冠のテクスチャ（4-9）: 縦の板は u -1〜1・v 0〜1、水平の板は -1〜1 の正方形
        vec2 uv = vCorner.z < 0.5 ? vec2(vCorner.x * 0.5 + 0.5, vCorner.y) : vCorner.xy * 0.5 + 0.5;
        vec2 atlas = (vTile + ${f(margin)} + uv * ${f(inner)}) / vec2(${f(cols)}, 2.0);
        vec4 crown = texture2D(uCrowns, atlas);
        if (crown.a < 0.5) discard;
        diffuseColor.rgb *= crown.r * ${f(CROWN_LUMA_SCALE)};`,
      );
  };
  material.customProgramCacheKey = () => 'tree-billboard';
  return material;
}

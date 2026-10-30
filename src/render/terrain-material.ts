// 地形のマテリアル（4-1 → 4-6）。画質「中」以上は PBR + シェーダーの中の層（傾斜と高さで砂浜 / 草地 / 森 /
// 岩 / 崖 / 雪。砂浜は海岸線からの距離で。terrain-layers-glsl.ts）、「低」は従来どおり Lambert（頂点カラーだけ）
import { MeshLambertMaterial, MeshStandardMaterial, type Material } from 'three';
import { TERRAIN_CONFIG, TERRAIN_DETAIL_CONFIG } from '../data/terrain';
import { CLOUD_GLSL, type CloudUniforms } from './cloud-field';
import { createCoastDistanceTexture } from './coast-textures';
import { terrainLayersGlsl } from './terrain-layers-glsl';

/** シェーダーの切り替え（define）。変えると再コンパイルする */
export interface TerrainShaderFlags {
  /** 雲の影（画質「高」） */
  cloudShadow: boolean;
  /** 岩・崖の法線の細部 */
  normalDetail: boolean;
  /** 木の影の代わりの暗いまだら（画質「高」） */
  treeShade: boolean;
}

const FLAG_KEYS = ['cloudShadow', 'normalDetail', 'treeShade'] as const;
const DEFINES: Record<(typeof FLAG_KEYS)[number], string> = {
  cloudShadow: 'CLOUD_SHADOW',
  normalDetail: 'TERRAIN_NORMAL_DETAIL',
  treeShade: 'TREE_SHADE',
};

/**
 * 画質「中」以上: PBR（粗い拡散面）+ 層の質感。影を受ける。
 * cloud を渡すと、define CLOUD_SHADOW で雲の影（直射光だけを暗くする）を付けられる（4-2）
 */
export function createDetailedTerrainMaterial(cloud?: CloudUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    roughness: TERRAIN_DETAIL_CONFIG.roughness,
    metalness: 0,
  });
  // 海岸線からの距離（砂浜の幅。4-8）
  const coast = {
    uCoastDist: { value: createCoastDistanceTexture() },
    uCoastSize: { value: TERRAIN_CONFIG.size },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, coast);
    if (cloud) Object.assign(shader.uniforms, cloud);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDetailNormal = mat3(modelMatrix) * objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${terrainLayersGlsl()}\n#ifdef CLOUD_SHADOW\n${CLOUD_GLSL}\n#endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // 光の向きはビュー空間なので、ビュー行列の転置でワールドに戻す
        vec3 terrainSun = vec3(0.0, 1.0, 0.0);
        #if NUM_DIR_LIGHTS > 0
          terrainSun = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
        #endif
        diffuseColor.rgb = terrainLayers(terrainSun);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifdef TERRAIN_NORMAL_DETAIL
          normal = normalize((viewMatrix * vec4(terrainDetailNormal(), 0.0)).xyz);
        #endif`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #ifdef CLOUD_SHADOW
          float cloudShade = cloudShadow(vDetailPos);
          reflectedLight.directDiffuse *= cloudShade;
          reflectedLight.directSpecular *= cloudShade;
        #endif
        #if defined(TREE_SHADE) && NUM_DIR_LIGHTS > 0
          reflectedLight.directDiffuse *= 1.0 - terrainTreeShade(terrainSun);
        #endif`,
      );
  };
  // onBeforeCompile の中身が違うことをプログラムのキャッシュに伝える
  material.customProgramCacheKey = () => 'terrain-layers';
  return material;
}

/** define を付け外しして再コンパイルする（変わったときだけ）。外すときは false（Three.js は書き出さない） */
export function setTerrainShaderFlags(
  material: MeshStandardMaterial,
  flags: Partial<TerrainShaderFlags>,
): void {
  const defines: Record<string, unknown> = (material.defines ??= {});
  let changed = false;
  for (const key of FLAG_KEYS) {
    const enabled = flags[key];
    if (enabled === undefined) continue;
    const name = DEFINES[key];
    const current = defines[name] !== undefined && defines[name] !== false;
    if (enabled === current) continue;
    defines[name] = enabled ? '' : false;
    changed = true;
  }
  if (changed) material.needsUpdate = true;
}

/** 画質「低」: 頂点カラーの Lambert（従来どおり。負荷を増やさない） */
export function createSimpleTerrainMaterial(): Material {
  return new MeshLambertMaterial({ vertexColors: true });
}

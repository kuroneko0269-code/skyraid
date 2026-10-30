// 機体のマテリアル（4-3）: PBR の塗装（色は頂点の色、パネルラインと汚れの手続きテクスチャ + 法線マップ）、
// キャノピー（半透明の濃い色 + クリアコートの反射）。自機の塗装は頂点シェーダーで操舵面を回し、撃ったミサイルを消す
import {
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  type Texture,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { AIRCRAFT_MODEL_CONFIG } from '../../data/aircraft-model';
import type { Hinge } from './build';
import { panelTextures } from './panel-texture';
import { MISSILE_PART_BASE, SURFACE_COUNT } from './planform';

/** 操舵面の回転軸・角度とミサイルの残りの数（自機の 1 機ぶん。毎フレーム書き換える） */
export interface SurfaceUniforms {
  readonly uHingePos: { value: Vector3[] };
  readonly uHingeAxis: { value: Vector3[] };
  readonly uHingeAngle: { value: number[] };
  readonly uMissiles: { value: number };
}

export function createSurfaceUniforms(): SurfaceUniforms {
  const list = (): Vector3[] => Array.from({ length: SURFACE_COUNT }, () => new Vector3(1, 0, 0));
  return {
    uHingePos: { value: list() },
    uHingeAxis: { value: list() },
    uHingeAngle: { value: new Array<number>(SURFACE_COUNT).fill(0) },
    uMissiles: { value: 0 },
  };
}

/** 生成した機体の回転軸を uniform に入れる */
export function setHinges(u: SurfaceUniforms, hinges: readonly Hinge[]): void {
  hinges.forEach((h, i) => {
    u.uHingePos.value[i]?.set(h.position.x, h.position.y, h.position.z);
    u.uHingeAxis.value[i]?.set(h.axis.x, h.axis.y, h.axis.z);
  });
}

const HEADER = /* glsl */ `
attribute float aPart;
uniform vec3 uHingePos[${SURFACE_COUNT}];
uniform vec3 uHingeAxis[${SURFACE_COUNT}];
uniform float uHingeAngle[${SURFACE_COUNT}];
uniform float uMissiles;
vec3 aircraftRotate(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
int aircraftSurface() {
  int p = int(aPart + 0.5);
  return (p >= 1 && p <= ${SURFACE_COUNT}) ? p - 1 : -1;
}
`;

const MOVE_NORMAL = /* glsl */ `
{
  int si = aircraftSurface();
  if (si >= 0) objectNormal = aircraftRotate(objectNormal, uHingeAxis[si], uHingeAngle[si]);
}
`;

// 撃ったミサイル（番号 > 残り）は頂点を 1 点に集めて消す
const MOVE_POSITION = /* glsl */ `
{
  int si = aircraftSurface();
  if (si >= 0) {
    vec3 h = uHingePos[si];
    transformed = h + aircraftRotate(transformed - h, uHingeAxis[si], uHingeAngle[si]);
  }
  if (aPart > ${MISSILE_PART_BASE}.5 && aPart - ${MISSILE_PART_BASE}.0 > uMissiles + 0.5) transformed = vec3(0.0);
}
`;

function patch(
  shader: WebGLProgramParametersWithUniforms,
  u: SurfaceUniforms,
  normals: boolean,
): void {
  Object.assign(shader.uniforms, u);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${HEADER}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${MOVE_POSITION}`);
  if (normals) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>\n${MOVE_NORMAL}`,
    );
  }
}

/** 空の環境マップ（4-10 事前修正）を受ける機体のマテリアルと効きの強さ。地形・海には付けない */
const envTargets = new Map<MeshStandardMaterial, number>();
let environment: Texture | null = null;

function useEnvironment<T extends MeshStandardMaterial>(material: T, intensity: number): T {
  envTargets.set(material, intensity);
  material.envMap = environment;
  material.envMapIntensity = intensity;
  return material;
}

/** 起動時に 1 回、空から作った環境マップを機体のマテリアル（作成済み・これから作るものすべて）に付ける */
export function setAircraftEnvironment(texture: Texture): void {
  environment = texture;
  for (const [material, intensity] of envTargets) {
    useEnvironment(material, intensity);
    material.needsUpdate = true;
  }
}

/** 機体の塗装（敵機・輸送機の InstancedMesh はこのまま。自機は animatePaint で動くパーツを付ける） */
export function createPaintMaterial(): MeshStandardMaterial {
  const t = panelTextures();
  const p = AIRCRAFT_MODEL_CONFIG.paint;
  const material = new MeshStandardMaterial({
    vertexColors: true,
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new Vector2(p.normalScale, p.normalScale),
    metalness: p.metalness,
    roughness: p.roughness,
  });
  return useEnvironment(material, p.envIntensity);
}

/** 塗装と影のマテリアルに操舵面・ミサイルのシェーダーを付ける（自機・ハンガー） */
export function animatePaint(
  material: MeshStandardMaterial,
  u: SurfaceUniforms,
): MeshDepthMaterial {
  material.onBeforeCompile = (shader) => {
    patch(shader, u, true);
  };
  material.customProgramCacheKey = () => 'aircraft-surfaces';
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    patch(shader, u, false);
  };
  depth.customProgramCacheKey = () => 'aircraft-surfaces-depth';
  return depth;
}

export function createCanopyMaterial(): MeshPhysicalMaterial {
  const c = AIRCRAFT_MODEL_CONFIG.canopy;
  const material = new MeshPhysicalMaterial({
    color: c.color,
    transparent: true,
    opacity: c.opacity,
    roughness: c.roughness,
    metalness: c.metalness,
    clearcoat: c.clearcoat,
    clearcoatRoughness: c.clearcoatRoughness,
  });
  return useEnvironment(material, c.envIntensity);
}

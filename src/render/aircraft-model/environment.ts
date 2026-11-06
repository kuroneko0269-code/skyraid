// 機体の環境マップ（4-10 事前修正）の受け口（material.ts から分けた。10-1: 空を焼く起動時の殻が機体のモデルの部品を読まずに渡せるように）
import type { MeshStandardMaterial, Texture } from 'three';

/** 空の環境マップを受ける機体のマテリアルと効きの強さ。地形・海には付けない */
const envTargets = new Map<MeshStandardMaterial, number>();
let environment: Texture | null = null;

export function useEnvironment<T extends MeshStandardMaterial>(material: T, intensity: number): T {
  envTargets.set(material, intensity);
  material.envMap = environment;
  material.envMapIntensity = intensity;
  return material;
}

/** 起動時に 1 回、空から作った環境マップを機体のマテリアル（作成済み・これから作るものすべて）に付ける */
export function setAircraftEnvironment(texture: Texture): void {
  // 7-5: 焼き直しの付け替え（環境マップあり → あり）はシェーダーの作り直しが要らない
  const first = environment === null;
  environment = texture;
  for (const [material, intensity] of envTargets) {
    useEnvironment(material, intensity);
    if (first) material.needsUpdate = true;
  }
}

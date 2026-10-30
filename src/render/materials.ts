// 発光する演出（曳光弾・火花・マズルフラッシュ・フレア・爆発の閃光）の PBR マテリアル（4-1）
import { Color, MeshStandardMaterial } from 'three';
import { SKY_CONFIG } from '../data/sky';
import { computeSkyLighting, sunDirection } from './atmosphere-model';

let baseExposure: number | null = null;

/** 初期の太陽の高さでの露出（発光の明るさを露出後の値で指定するため。初回だけ計算する） */
function exposure(): number {
  baseExposure ??= computeSkyLighting(
    sunDirection(SKY_CONFIG.sun.azimuth, SKY_CONFIG.sun.elevation),
  ).exposure;
  return baseExposure;
}

/**
 * 光を受けず自分で光るマテリアル（基本色は黒、emissive = 色 × intensity ÷ 露出）。intensity は露出後の
 * 明るさ（1 で色そのまま）。大きくするとトーンマッピング後に白く飛び、画質「高」ではブルームで光る。
 * 霧（空気遠近）は掛けない
 */
export function createEmissiveMaterial(color: number, intensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0x000000,
    emissive: new Color(color),
    emissiveIntensity: intensity / exposure(),
    roughness: 1,
    metalness: 0,
    fog: false,
  });
}

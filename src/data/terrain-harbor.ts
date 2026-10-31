// 港湾都市（Harbor City。6-4）の地形のパラメータ。形は src/render/terrain-gen/harbor-shape.ts、
// 浸食・質感・LOD は島（TERRAIN_CONFIG）と同じ仕組みで、数値だけ変える。距離・高さは m。北 −Z・南 +Z
import { TERRAIN_CONFIG, type TerrainParams } from './terrain';
import { CITY_CONFIG } from './city';

const city = CITY_CONFIG.rect;

export const HARBOR_TERRAIN: TerrainParams = {
  ...TERRAIN_CONFIG,
  seed: 20261104,
  size: 8000,
  shape: {
    ...TERRAIN_CONFIG.shape,
    seaDepth: 40,
    /** 自然の海岸の棚の幅（harbor では km 単位: 0.5 = 500m） */
    shelfWidth: 0.5,
    harbor: {
      landHalf: 3450,
      edgeFall: 300,
      edgeNoise: 160,
      // 湾: 中央 2.9km は街の南端（岸壁）と同じ z の直線。その外は南へ曲がる（x = ±3450 で約 z 3290）
      bayZ: city.maxZ,
      bayHalfWidth: 1450,
      bayCurve: 0.00045,
      quayDepth: 14,
      beachWidth: 160,
      plainLow: 6,
      plainSlope: 0.005,
      hillAmplitude: 14,
      hillFrequency: 1 / 900,
      // 北の山: 尾根 z = −2700、高さ 300m（尾根のノイズで ±数十 m）
      ridgeZ: -2700,
      ridgeWidth: 650,
      ridgeHeight: 300,
      ridgeDetail: 70,
      ridgeFrequency: 1 / 650,
      flat: {
        minX: city.minX - 60,
        maxX: city.maxX + 60,
        minZ: city.minZ - 60,
        maxZ: city.maxZ + 40,
        height: CITY_CONFIG.groundHeight,
        blend: 260,
      },
    },
  },
  erosion: {
    ...TERRAIN_CONFIG.erosion,
    // 8km 全体を覆う。平野と街（海抜 30m 未満）は浸食しない（山だけ）
    extent: 8000,
    minHeight: 30,
    fadeHeight: 70,
    seedOffset: 11,
    droplets: 24000,
  },
};

// 港湾都市の地形の形（6-4。Three.js 非依存）。8km 四方の陸の南側が湾（中央は直線の岸壁）、平野が広く、北に低い山。
// 街の範囲は平らにする。浸食・質感・木は島と同じ仕組み（terrain-height.ts）をパラメータ違いで使う。
// 座標は北 −Z・南 +Z・東 +X
import type { HarborShapeParams } from '../../data/terrain';
import type { SimplexNoise2D } from '../noise';
import type { ShapeModel, TerrainConfig } from '../terrain-height';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 湾の海岸線の z（ノイズなし）。|x| < bayHalfWidth は直線 */
export function harborCoastZ(h: HarborShapeParams, x: number): number {
  const out = Math.max(0, Math.abs(x) - h.bayHalfWidth);
  return h.bayZ + h.bayCurve * out * out;
}

/** 街を平らにする重み（範囲の中 1、まわり blend m で 0 へ） */
export function harborFlatWeight(h: HarborShapeParams, x: number, z: number): number {
  const f = h.flat;
  const dx = Math.max(f.minX - x, 0, x - f.maxX);
  const dz = Math.max(f.minZ - z, 0, z - f.maxZ);
  return 1 - smoothstep(0, f.blend, Math.hypot(dx, dz));
}

export function harborShape(
  config: TerrainConfig,
  h: HarborShapeParams,
  noise: SimplexNoise2D,
): ShapeModel {
  const seaFloor = config.seaLevel - config.shape.seaDepth;
  const seaDepth = config.shape.seaDepth;
  const shelf = config.shape.shelfWidth * 1000;

  /** 海岸からの符号付きの距離（陸が正）と、岸壁らしさ（0〜1） */
  const coast = (x: number, z: number): { d: number; quay: number } => {
    // 直線の岸壁の外だけ海岸線を揺らす
    const wobble =
      h.edgeNoise *
      noise.fbm(x / 1300 + 5.1, z / 1300 - 2.3, 3) *
      smoothstep(h.bayHalfWidth - 100, h.bayHalfWidth + 400, Math.abs(x));
    const south = harborCoastZ(h, x) + wobble - z;
    const ne = h.edgeNoise * noise.fbm(x / 1500 - 9.7, z / 1500 + 4.4, 3);
    const edge = Math.min(z + h.landHalf + ne, h.landHalf - x + ne, h.landHalf + x - ne);
    const quay =
      south <= edge ? 1 - smoothstep(h.bayHalfWidth - 50, h.bayHalfWidth + 150, Math.abs(x)) : 0;
    return { d: Math.min(south, edge), quay };
  };

  /** 陸の高さ（海岸の処理の前） */
  const land = (x: number, z: number): number => {
    const plain = h.plainLow + h.plainSlope * Math.max(0, h.bayZ - z);
    const flat = harborFlatWeight(h, x, z);
    const hills =
      h.hillAmplitude * noise.fbm(x * h.hillFrequency - 47.1, z * h.hillFrequency + 5.3, 4);
    const dz = (z - h.ridgeZ) / h.ridgeWidth;
    const mountain = Math.exp(-dz * dz) * (0.82 + 0.18 * noise.noise(x / 1700 + 13.3, 7.7));
    const ridged = noise.ridged(x * h.ridgeFrequency + 88.8, z * h.ridgeFrequency + 61.2, 4);
    const ridge = h.ridgeHeight * mountain + h.ridgeDetail * (ridged - 0.5) * mountain;
    const natural = plain + hills * (1 - 0.7 * mountain) + ridge;
    return natural + (h.flat.height - natural) * flat;
  };

  const shapeHeight = (x: number, z: number): number => {
    const { d, quay } = coast(x, z);
    let y: number;
    if (d >= 0) {
      // 自然の海岸は浜（beachWidth m で陸の高さへ）、岸壁はすぐ陸の高さ
      const rise =
        smoothstep(0, h.beachWidth, d) +
        (smoothstep(0, 6, d) - smoothstep(0, h.beachWidth, d)) * quay;
      y = land(x, z) * rise;
    } else {
      const natural = -seaDepth * smoothstep(0, shelf, -d);
      const quayFloor =
        -(h.quayDepth + (seaDepth - h.quayDepth) * smoothstep(0, 600, -d)) * smoothstep(0, 6, -d);
      y = natural + (quayFloor - natural) * quay;
    }
    return Math.max(y, seaFloor);
  };

  return {
    shapeHeight,
    cliff: () => 0,
    coastSide: () => ({ windward: 0, leeward: 0 }),
    isOpenSea: (x, z) => coast(x, z).d < -shelf - 200,
  };
}

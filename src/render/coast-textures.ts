// 水深と海岸線からの距離のテクスチャ（4-2 → 4-8）。地形の高さ関数から水深の格子を起動時に 1 回だけ焼き、
// 海面（水深）と地形（砂浜の幅。海岸線からの距離）で同じ格子を使う。浮動小数点（半精度）・線形補間
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat } from 'three';
import { OCEAN_CONFIG } from '../data/ocean';
import { TERRAIN_CONFIG } from '../data/terrain';
import { bakeCoastDistance } from './coast-distance';
import { bakeDepthField, type DepthField } from './ocean-depth';
import { getHeight, type HeightFn } from './terrain-height';

let depthField: DepthField | null = null;

/** 既定の島の水深の格子（一辺 TERRAIN_CONFIG.size。最初に呼んだときに焼く） */
function defaultDepthField(): DepthField {
  depthField ??= bakeDepthField(
    getHeight,
    TERRAIN_CONFIG.size,
    OCEAN_CONFIG.depthMap.resolution,
    TERRAIN_CONFIG.seaLevel,
  );
  return depthField;
}

function halfFloatTexture(data: Float32Array, resolution: number): DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < half.length; i++) half[i] = DataUtils.toHalfFloat(data[i] ?? 0);
  const texture = new DataTexture(half, resolution, resolution, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** 水深と海岸線からの距離のテクスチャ（6-4: マップを切り替えるたびに焼き直す。捨てるときは dispose） */
export interface CoastTextures {
  readonly depth: DataTexture;
  readonly coast: DataTexture;
  readonly size: number;
  dispose(): void;
}

/** 高さ関数から焼く（一辺 size、uv = xz / size + 0.5） */
export function bakeCoastTextures(height: HeightFn, size: number, seaLevel: number): CoastTextures {
  const field = bakeDepthField(height, size, OCEAN_CONFIG.depthMap.resolution, seaLevel);
  const depth = halfFloatTexture(field.data, field.resolution);
  const coast = halfFloatTexture(bakeCoastDistance(field), field.resolution);
  return {
    depth,
    coast,
    size,
    dispose: () => {
      depth.dispose();
      coast.dispose();
    },
  };
}

/** 水深（m。陸は負）のテクスチャ。uv = xz / TERRAIN_CONFIG.size + 0.5 */
export function createDepthTexture(): DataTexture {
  const field = defaultDepthField();
  return halfFloatTexture(field.data, field.resolution);
}

/** 海岸線からの符号付き距離（m。陸が正）のテクスチャ。uv は水深と同じ */
export function createCoastDistanceTexture(): DataTexture {
  const field = defaultDepthField();
  return halfFloatTexture(bakeCoastDistance(field), field.resolution);
}

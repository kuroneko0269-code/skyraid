// 島の高さ関数（Three.js 非依存）。地形メッシュの生成と、機体・カメラの地面判定の両方で使う
import { TERRAIN_CONFIG } from '../data/terrain';
import { SimplexNoise2D } from './noise';

export type TerrainConfig = typeof TERRAIN_CONFIG;

/** (x, z) → 高さ（m）。y が上 */
export type HeightFn = (x: number, z: number) => number;

export interface HeightField {
  /** 地形の高さ。海の下では負になる */
  getHeight: HeightFn;
  /** 衝突に使う地表の高さ。海の上では海面 */
  getGroundHeight: HeightFn;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 中央に山がある島の高さ関数を作る。
 * 中心からの距離を「海岸線の半径」（ノイズで出入り）で割った t（中心 0・海岸 1）で形を決め、
 * 山の中腹に丘と尾根のノイズを足す
 */
export function createHeightField(config: TerrainConfig = TERRAIN_CONFIG): HeightField {
  const s = config.shape;
  const noise = new SimplexNoise2D(config.seed);
  const coastOffset = Math.exp(-s.peakSharpness);

  const getHeight = (x: number, z: number): number => {
    const d = Math.sqrt(x * x + z * z);
    // ノイズごとに座標をずらして、海岸線・丘・尾根の模様が重ならないようにする
    const warp = noise.fbm(x * s.coastFrequency + 31.7, z * s.coastFrequency - 12.9, 3);
    const t = d / (s.coastRadius * (1 + s.coastWarp * warp));

    const mountain = Math.exp(-s.peakSharpness * t * t);
    // t = 1（海岸）でちょうど 0 になる土台。海岸より外は負（海底）へ続く
    let h = s.peakHeight * (mountain - coastOffset) + s.lowlandHeight * (1 - t);

    // 丘・尾根は海岸の手前で消して、砂浜をなだらかにする
    const land = 1 - smoothstep(0.7, 1, t);
    if (land > 0) {
      const hf = s.hillFrequency;
      const hills = noise.fbm(x * hf - 47.1, z * hf + 5.3, s.hillOctaves);
      h += s.hillAmplitude * hills * land * (0.35 + 0.65 * mountain);
      const rf = s.ridgeFrequency;
      const ridge = noise.ridged(x * rf + 88.8, z * rf + 61.2, 4);
      h += s.ridgeAmplitude * (ridge - 0.5) * mountain;
    }

    h -= s.seaDepth * smoothstep(1, 1 + s.shelfWidth, t);
    return Math.max(h, config.seaLevel - s.seaDepth);
  };

  return {
    getHeight,
    getGroundHeight: (x, z) => Math.max(getHeight(x, z), config.seaLevel),
  };
}

/** 既定の島（TERRAIN_CONFIG のシード） */
const defaultField = createHeightField();

/** 既定の島の高さ（m）。海の下では負 */
export const getHeight: HeightFn = defaultField.getHeight;

/** 既定の島の、衝突に使う地表の高さ（海の上では海面） */
export const getGroundHeight: HeightFn = defaultField.getGroundHeight;

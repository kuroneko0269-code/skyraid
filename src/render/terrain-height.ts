// 島の高さ関数（Three.js 非依存）。地形メッシュの生成と、機体・カメラの地面判定の両方で使う
import { TERRAIN_CONFIG } from '../data/terrain';
import { WIND_CONFIG } from '../data/wind';
import { SimplexNoise2D } from './noise';
import { erode } from './terrain-gen/erosion';

export type TerrainConfig = typeof TERRAIN_CONFIG;

/** (x, z) → 高さ（m）。y が上 */
export type HeightFn = (x: number, z: number) => number;

export interface HeightField {
  /** 地形の高さ。海の下では負になる */
  getHeight: HeightFn;
  /** 衝突に使う地表の高さ。海の上では海面 */
  getGroundHeight: HeightFn;
  /** 浸食する前の高さ（テスト・比較用） */
  getBaseHeight: HeightFn;
  /** 海岸の向き: 風上（崖）らしさ 0〜1 と風下（砂浜）らしさ 0〜1。どちらかは 0 */
  coastSide(x: number, z: number): { windward: number; leeward: number };
  /** 浸食にかかった時間（ms。浸食しない設定なら 0） */
  readonly erosionMs: number;
}

export interface HeightFieldOptions {
  /** false で浸食しない（TERRAIN_CONFIG.erosion.enabled より優先） */
  erosion?: boolean;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 一様 3 次 B スプラインの 1 次元の補間（p0..p3 の間、p1〜p2 を t で）。Catmull-Rom と違い格子点を通らないが
 * 行き過ぎがなく 2 階微分まで連続で、格子の段が斜面の陰影に出にくい（4-8）
 */
function bspline(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (u * u * u * p0 + (3 * t3 - 6 * t2 + 4) * p1 + (-3 * t3 + 3 * t2 + 3 * t + 1) * p2 + t3 * p3) /
    6
  );
}

/** 格子を [1, 2, 1] / 4 の二項フィルタで縦横に passes 回ならす（端の 1 列はそのまま） */
export function smoothGrid(grid: Float32Array, res: number, passes: number): void {
  const tmp = new Float32Array(grid.length);
  for (let p = 0; p < passes; p++) {
    tmp.set(grid);
    for (let j = 0; j < res; j++) {
      for (let i = 1; i < res - 1; i++) {
        const k = i + j * res;
        grid[k] = ((tmp[k - 1] ?? 0) + 2 * (tmp[k] ?? 0) + (tmp[k + 1] ?? 0)) / 4;
      }
    }
    tmp.set(grid);
    for (let j = 1; j < res - 1; j++) {
      for (let i = 0; i < res; i++) {
        const k = i + j * res;
        grid[k] = ((tmp[k - res] ?? 0) + 2 * (tmp[k] ?? 0) + (tmp[k + res] ?? 0)) / 4;
      }
    }
  }
}

/**
 * 中央に山がある島の高さ関数を作る。
 * 中心からの距離を「海岸線の半径」（ノイズで出入り）で割った t（中心 0・海岸 1）で形を決め、
 * 山の中腹に丘と尾根のノイズを足す。海岸は風上を崖・風下を砂浜にし（4-6）、
 * 最後に海抜 5m 以上へ水力浸食の差分を足す（4-6）
 */
export function createHeightField(
  config: TerrainConfig = TERRAIN_CONFIG,
  options: HeightFieldOptions = {},
): HeightField {
  const s = config.shape;
  const c = s.coast;
  const noise = new SimplexNoise2D(config.seed);
  const coastOffset = Math.exp(-s.peakSharpness);
  const windAngle = (WIND_CONFIG.direction * Math.PI) / 180;
  const windX = Math.cos(windAngle);
  const windZ = Math.sin(windAngle);

  const coastSide = (x: number, z: number): { windward: number; leeward: number } => {
    const d = Math.sqrt(x * x + z * z);
    // 中心から見た向きと風向き（吹いていく向き）の内積。正 = 風下、負 = 風上
    const along = d > 1e-6 ? (x * windX + z * windZ) / d : 0;
    const wobble = c.sideNoise * noise.noise(x / 2400 + 3.1, z / 2400 - 7.7);
    const v = along + wobble;
    return {
      windward: smoothstep(c.sideFrom, c.sideTo, -v),
      leeward: smoothstep(c.sideFrom, c.sideTo, v),
    };
  };

  // 風上の崖の高さ（shapeHeight が書く）。浸食は崖を除いた形に掛け、崖は後から足す（格子より細い崖を浸食で崩さない）
  let cliff = 0;

  /** 崖を除いた形の高さ（m）。崖の高さは cliff に入れる */
  const shapeHeight = (x: number, z: number): number => {
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

    // 海岸の作り分け（t = 1 では h = 0 のままなので海岸線は動かない）
    cliff = 0;
    const side = t > c.beachFrom - 0.05 && t < 1 + s.shelfWidth ? coastSide(x, z) : null;
    let shelf = s.shelfWidth;
    if (side) {
      if (t < 1) {
        // 風下: 海岸の手前を低くして遠浅の浜を広げる
        h *= 1 - c.beachFlatten * side.leeward * smoothstep(c.beachFrom, 1, t);
        // 風上: 内陸からゆるく上がった台地が、海岸の cliffWidth の幅で cliffHeight 切れ落ちる崖
        const plateau = smoothstep(c.beachFrom, 1 - 6 * c.cliffWidth, t);
        cliff = c.cliffHeight * side.windward * plateau * (1 - smoothstep(1 - c.cliffWidth, 1, t));
      }
      shelf *= 1 - c.cliffShelf * side.windward;
    }

    h -= s.seaDepth * smoothstep(1, 1 + shelf, t);
    return Math.max(h, config.seaLevel - s.seaDepth);
  };

  const getBaseHeight = (x: number, z: number): number => shapeHeight(x, z) + cliff;

  // ---- 浸食（起動時に 1 回。格子の差分をならして 3 次 B スプラインで補間して足す。4-8） ----
  const e = config.erosion;
  const useErosion = options.erosion ?? e.enabled;
  const res = e.resolution;
  const cell = e.extent / (res - 1);
  const half = e.extent / 2;
  let delta: Float32Array | null = null;
  let erosionMs = 0;
  if (useErosion) {
    const t0 = performance.now();
    const heights = new Float32Array(res * res);
    const mask = new Float32Array(res * res);
    const depositScale = new Float32Array(res * res);
    const maxCoast = s.coastRadius * (1 + s.coastWarp) + 100;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const x = -half + i * cell;
        const z = -half + j * cell;
        const k = i + j * res;
        // 海岸線の最大半径より外は必ず海（浸食しない）。ノイズの計算を省く
        if (x * x + z * z > maxCoast * maxCoast) {
          heights[k] = config.seaLevel - s.seaDepth;
          continue;
        }
        const h = shapeHeight(x, z);
        heights[k] = h;
        mask[k] = smoothstep(e.minHeight, e.fadeHeight, h);
        const side = coastSide(x, z);
        depositScale[k] = (1 + e.leeDeposit * side.leeward) * (1 - e.windwardLoss * side.windward);
      }
    }
    const before = heights.slice();
    erode({ resolution: res, heights, mask, depositScale }, e, config.seed + e.seedOffset);
    delta = new Float32Array(res * res);
    for (let k = 0; k < delta.length; k++) delta[k] = (heights[k] ?? 0) - (before[k] ?? 0);
    // 1〜2 マス（約 29〜58m）の凸凹（堆積の段）を消す。谷の溝はもっと幅が広いので残る
    smoothGrid(delta, res, e.smoothPasses);
    erosionMs = performance.now() - t0;
  }

  const sampleDelta = (x: number, z: number): number => {
    if (!delta) return 0;
    const gx = (x + half) / cell;
    const gz = (z + half) / cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    if (i < 1 || j < 1 || i >= res - 2 || j >= res - 2) return 0;
    const fx = gx - i;
    const fz = gz - j;
    const d = delta;
    const row = (jj: number): number => {
      const k = i + jj * res;
      return bspline(d[k - 1] ?? 0, d[k] ?? 0, d[k + 1] ?? 0, d[k + 2] ?? 0, fx);
    };
    return bspline(row(j - 1), row(j), row(j + 1), row(j + 2), fz);
  };

  const getHeight = (x: number, z: number): number => {
    const shape = shapeHeight(x, z);
    const coastCliff = cliff;
    if (!delta || shape <= e.minHeight) return shape + coastCliff;
    // 補間の行き過ぎで海抜 5m 未満に効かないよう、元の高さでもう一度効きを掛ける。
    // 削っても minHeight より下にはしない（海岸線と浅瀬の形を変えない）
    const eroded = shape + sampleDelta(x, z) * smoothstep(e.minHeight, e.fadeHeight, shape);
    return Math.max(eroded, e.minHeight) + coastCliff;
  };

  return {
    getHeight,
    getGroundHeight: (x, z) => Math.max(getHeight(x, z), config.seaLevel),
    getBaseHeight,
    coastSide,
    erosionMs,
  };
}

/** 既定の島（TERRAIN_CONFIG のシード。起動時に 1 回だけ浸食する） */
export const defaultHeightField: HeightField = createHeightField();

/** 既定の島の高さ（m）。海の下では負 */
export const getHeight: HeightFn = defaultHeightField.getHeight;

/** 既定の島の、衝突に使う地表の高さ（海の上では海面） */
export const getGroundHeight: HeightFn = defaultHeightField.getGroundHeight;

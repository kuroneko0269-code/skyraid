// マップ（戦域）の定義（2-4 → 6-4 で複数マップ）。距離は m、時間は秒。北 −Z・南 +Z・東 +X
// 戦域の境界は水平の円（中心・半径）。出ると HUD に「RETURN TO BATTLEFIELD」と returnSeconds のカウントを出す。
// マップごとに地形（シード・大きさ・海岸線の形）・街の有無・開始位置・怪獣の上陸地点を持つ。
// フリーフライトと PvP は選べる（selectable）。キャンペーンの M1〜M5 は島、レイドは港湾都市に固定（ミッションの mapId）
import { CITY_CONFIG } from './city';
import { TERRAIN_CONFIG, WORLD_CONFIG, type TerrainParams } from './terrain';
import { HARBOR_TERRAIN } from './terrain-harbor';

export interface MapPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 機首の方位（度。0 = −Z、180 = +Z） */
  readonly headingDeg: number;
}

/** 木の撒き方の違い（6-4）。島はすべて既定（木の配置・地面の森の層は 4-9 のまま） */
export interface MapVegetation {
  /** 候補を撒く範囲の半径 */
  readonly radius: number;
  /** 地表 lowlandFull m より低い所は森の密度を lowlandScale 倍（lowlandFrom m まで）。1 なら変えない */
  readonly lowlandScale: number;
  readonly lowlandFrom: number;
  readonly lowlandFull: number;
  /** 木を置かない四角（街。null はなし） */
  readonly clear: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  } | null;
}

export interface MapDef {
  readonly id: string;
  readonly name: string;
  /** 戦域の中心（水平）と半径 */
  readonly center: { readonly x: number; readonly z: number };
  readonly radius: number;
  /** 境界を出てから戻るまでの猶予。ミッションではこれを過ぎると失敗、フリーフライトでは警告だけ */
  readonly returnSeconds: number;
  /** 地形の生成のパラメータ（シード・大きさ・形） */
  readonly terrain: TerrainParams;
  /** 街（src/data/city.ts）があるか */
  readonly city: boolean;
  /** フリーフライトの開始位置（墜落後は墜落地点の上空） */
  readonly start: MapPose;
  /** 怪獣の上陸地点と向かう先。arrivalFails なら向かう先（の reachRadius 内）に着くと失敗 */
  readonly kaiju: {
    readonly from: { readonly x: number; readonly z: number };
    readonly goal: { readonly x: number; readonly z: number };
    readonly arrivalFails: boolean;
  };
  /** レイドの開始位置 */
  readonly raidStart: MapPose;
  readonly vegetation: MapVegetation;
  /** フリーフライト・PvP で選べるか */
  readonly selectable: boolean;
}

/**
 * 島。半径 6000m は海岸線（平均 2900m、最大 約 3400m）の約 2 倍、起動位置（中心から 4500m）より 1.5km 外。
 * 巡航（250 m/s）で境界の外へ 10 秒飛ぶと 2.5km 出る。旋回して戻るには十分な猶予
 */
export const ISLAND_MAP: MapDef = {
  id: 'island',
  name: '海岸と島',
  center: { x: 0, z: 0 },
  radius: 6000,
  returnSeconds: 10,
  terrain: TERRAIN_CONFIG,
  city: false,
  start: { ...WORLD_CONFIG.start, headingDeg: 0 },
  // 6-2 のレイド（島）の値。島のレイドは 6-4 から無い（M5 は自分のミッションの定義で出す）
  kaiju: { from: { x: 2800, z: 2800 }, goal: { x: 0, z: 0 }, arrivalFails: false },
  raidStart: { x: 3700, y: 700, z: 5200, headingDeg: -21 },
  vegetation: { radius: 3500, lowlandScale: 1, lowlandFrom: 0, lowlandFull: 0, clear: null },
  selectable: true,
};

const city = CITY_CONFIG.rect;

/**
 * 港湾都市（6-4）。8km 四方（陸は ±3450m）、南が湾で街（2.5km × 1.5km）が岸壁に面する。北に低い山（約 300m）。
 * 戦域は島と同じ半径 6000m
 */
export const HARBOR_MAP: MapDef = {
  id: 'harbor',
  name: '港湾都市',
  center: { x: 0, z: 0 },
  radius: 6000,
  returnSeconds: 10,
  terrain: HARBOR_TERRAIN,
  city: true,
  // 湾の沖（岸壁から 3km）、高度 500m、街の方（北）を向く
  start: { x: 0, y: 500, z: 4500, headingDeg: 0 },
  // 湾の沖 3km（岸壁 z 1500 から）から上陸し、タワー群へ
  kaiju: { from: { x: 0, z: city.maxZ + 3000 }, goal: CITY_CONFIG.center, arrivalFails: true },
  // 街の北、高度 800m、機首を湾側（南。怪獣の方）へ
  raidStart: { x: 0, y: 800, z: city.minZ - 700, headingDeg: 180 },
  vegetation: {
    radius: 4300,
    lowlandScale: 0.12,
    lowlandFrom: 25,
    lowlandFull: 60,
    clear: {
      minX: city.minX - 40,
      maxX: city.maxX + 40,
      minZ: city.minZ - 40,
      maxZ: city.maxZ + 200,
    },
  },
  selectable: true,
};

export const MAPS: Readonly<Record<string, MapDef>> = {
  [ISLAND_MAP.id]: ISLAND_MAP,
  [HARBOR_MAP.id]: HARBOR_MAP,
};

/** 選べるマップの並び（ロビー・フリーフライト） */
export const SELECTABLE_MAPS: readonly MapDef[] = [ISLAND_MAP, HARBOR_MAP];

export function findMap(id: string): MapDef {
  return MAPS[id] ?? ISLAND_MAP;
}

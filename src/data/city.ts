// 港湾都市の街（6-4）の数値。配置の生成は src/render/city/layout.ts（Three.js 非依存）、描画は src/render/city/、
// 壊れる状態と当たり判定は src/combat/buildings.ts。距離・高さは m、時間は秒。北 −Z・南 +Z・東 +X

export type BuildingKind = 'low' | 'mid' | 'tower' | 'warehouse';

export interface BuildingKindSpec {
  /** 階数の範囲と 1 階の高さ */
  readonly floors: readonly [number, number];
  readonly floorHeight: number;
  /** 建物の色（sRGB。手続きの窓の格子の下地）。個体差は ±tint の明るさ */
  readonly color: number;
  readonly tint: number;
  /** 窓の格子: 横の間隔（m）と、窓の割合（横・縦） */
  readonly windowSpacing: number;
  readonly windowRatio: readonly [number, number];
}

export const CITY_CONFIG = {
  /** 街の範囲（2.5km × 1.5km）。南端は湾の岸壁（海岸線の直線部 z = maxZ） */
  rect: { minX: -1250, maxX: 1250, minZ: 0, maxZ: 1500 },
  /** 街の地面の高さ（地形をこの高さで平らにする） */
  groundHeight: 6,
  /** 配置の乱数のシード */
  seed: 640,
  road: {
    /** 道路の中心線の間隔（x・z とも）と幅。mainEvery 本ごとに主要道路 */
    spacing: 100,
    width: 20,
    mainWidth: 40,
    mainEvery: 4,
    /** 建物と道路・区画の縁の間（歩道） */
    setback: 4,
  },
  /** 港: 岸壁から北へ depth m は倉庫の帯（海沿いの主要道路の南）。桟橋は岸壁から南（海）へ */
  port: {
    depth: 150,
    piers: 5,
    pierLength: 230,
    pierWidth: 28,
    pierDeck: 3,
    cranes: 10,
    craneHeight: 52,
    warehouse: { length: [50, 90] as const, width: [24, 34] as const, height: [9, 14] as const },
  },
  /** タワー（中心部に 6〜10 棟）を置く中心と、中層を置く半径 */
  center: { x: 0, z: 700 },
  towers: { min: 6, max: 10, radius: 420 },
  midRadius: 950,
  /** 区画の中の低層の敷地の一辺（区画を 3〜5 × 3〜5 に分ける） */
  lowLots: [3, 5] as const,
  midLots: [1, 3] as const,
  kinds: {
    low: {
      floors: [2, 4],
      floorHeight: 3.2,
      color: 0xcdbfa6,
      tint: 0.18,
      windowSpacing: 4,
      windowRatio: [0.45, 0.45],
    },
    mid: {
      floors: [8, 15],
      floorHeight: 3.6,
      color: 0xb4b6b4,
      tint: 0.14,
      windowSpacing: 3.2,
      windowRatio: [0.5, 0.45],
    },
    tower: {
      floors: [25, 40],
      floorHeight: 3.8,
      color: 0x9fb0c0,
      tint: 0.12,
      windowSpacing: 2.6,
      windowRatio: [0.62, 0.55],
    },
    warehouse: {
      floors: [1, 1],
      floorHeight: 11,
      color: 0x8e8573,
      tint: 0.15,
      windowSpacing: 12,
      windowRatio: [0.15, 0.2],
    },
  } satisfies Record<BuildingKind, BuildingKindSpec>,
  /** 建物の数（判定・「守れた建物」はすべて。描画の数は画質の cityBuildings: 低 800 / 中 2000 / 高 4000） */
  count: 4000,
  /** これより高い建物だけ自機と衝突する（低層は飛び抜けられる） */
  collisionMinHeight: 40,
  /** 自機の当たり判定の半径（建物の箱をこれだけ膨らませる） */
  aircraftRadius: 4,
  /** 遠景の LOD: カメラからこの距離より遠い建物は箱 1 つ。見直しはカメラが refresh m 動くごと */
  lodDistance: 1400,
  lodRefresh: 80,
  /** 崩れる: 高さが collapseSeconds で 0 へ縮み、瓦礫（rubbleHeight m の低い箱）に置き換え */
  collapseSeconds: 0.4,
  rubbleHeight: [3, 6] as const,
  rubbleColor: 0x6d665d,
  /** 怪獣が壊す範囲: 歩くと足元から footRadius、薙ぎ払いは sweepRadius（尾の届く範囲）、熱線は幅の半分 */
  kaiju: { footRadius: 55, sweepRadius: 190 },
  /** 怪獣の到達で失敗する距離（タワー群の中心からの水平距離。止まる距離と同じ） */
  reachRadius: 450,
  /** 粉塵（崩れるとき）: 1 棟あたりの玉の数（高さ 30m ごとに 1 つ足す）・寿命・大きさ */
  dust: {
    puffs: 3,
    perHeight: 30,
    max: 600,
    life: 3.5,
    startSize: 14,
    endSize: 55,
    color: 0x9a8f80,
  },
  /** 破片 */
  debris: { perBuilding: 6, max: 400, life: 2.2, speed: 22, size: 3 },
  /** 道路の色・歩道・区画の地面 */
  ground: { asphalt: 0x3b3d40, line: 0xd8d2b0, sidewalk: 0x8f8b84, lot: 0x6f7a55 },
  /** 港の設備の色 */
  portColors: {
    pier: 0x7c7770,
    crane: 0xd0782a,
    container: [0x2f6db0, 0xb83a2a, 0x3b8a4a, 0xd0a030] as const,
  },
} as const;

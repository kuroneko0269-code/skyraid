// 島の地形のパラメータ（1-3）。空は src/data/sky.ts（4-1）、海は src/data/ocean.ts、雲は src/data/clouds.ts（4-2）。
// 高さの計算は src/render/terrain-height.ts、メッシュと LOD は src/render/terrain.ts。距離・高さは m

export const TERRAIN_CONFIG = {
  /** ノイズのシード。同じシードなら同じ島になる */
  seed: 20261029,
  /** 地形メッシュを作る範囲の一辺（島の中心が原点）。外側は海面だけ */
  size: 8000,
  /** 範囲を chunks × chunks に分けて、チャンクごとに LOD を選ぶ */
  chunks: 4,
  /** 海面の高さ。これより低い地形は海の下 */
  seaLevel: 0,
  shape: {
    /** 海岸線の平均半径。ノイズで ±coastWarp の割合だけ出入りする */
    coastRadius: 2900,
    coastWarp: 0.18,
    /** 海岸線の出入りのノイズの周波数（1/m） */
    coastFrequency: 1 / 1800,
    /** 中央の山の高さ（ノイズで ±数十 m 変わる） */
    peakHeight: 500,
    /** 山の裾の広がり。値が大きいほど尖る（exp(-k t²)、t は中心 0・海岸 1） */
    peakSharpness: 4,
    /** 山とは別に、海岸から中心に向かって上がる平地の高さ（中心で最大） */
    lowlandHeight: 80,
    /** 丘・尾根のノイズ（fBm）の振幅と周波数。振幅は山に近いほど大きい */
    hillAmplitude: 70,
    hillFrequency: 1 / 900,
    hillOctaves: 5,
    /** 山の尾根（リッジノイズ）の振幅。山の中腹〜頂上で効く */
    ridgeAmplitude: 90,
    ridgeFrequency: 1 / 700,
    /** 海岸から沖へ海底が下がる幅（t の単位）と最大深さ */
    shelfWidth: 0.35,
    seaDepth: 60,
    /**
     * 海岸の作り分け（4-6）。外洋側（風上。src/data/wind.ts の風が吹いてくる側）は崖、風下側は遠浅の砂浜。
     * 風上らしさは「中心から見た向きと風向きの内積」をノイズで揺らして決める。どちらも海岸線（t = 1）の位置は変えない
     */
    coast: {
      /** 内積がこの範囲で 0 → 1（風上・風下それぞれ）。境目をノイズでずらす量 */
      sideFrom: -0.15,
      sideTo: 0.55,
      sideNoise: 0.3,
      /** 風上の崖の高さ（m）と、海岸から内陸へ崖が立ち上がる幅（t の単位。0.012 × 2900m ≒ 35m） */
      cliffHeight: 32,
      cliffWidth: 0.012,
      /** 風上の海底は棚の幅をこの割合だけ狭める（崖の下はすぐ深い） */
      cliffShelf: 0.55,
      /** 風下は t がこの値から海岸までの土地をなだらかにして（最大 beachFlatten の割合だけ低く）浜を広げる */
      beachFrom: 0.8,
      beachFlatten: 0.55,
    },
  },
  /**
   * 生成時の水力浸食（4-6。src/render/terrain-gen/erosion.ts）。島を覆う範囲を resolution × resolution の格子で
   * 浸食し、元の高さとの差分を高さ関数に足す（細部は従来のノイズのまま）。海抜 minHeight m より下は変えない
   * （海岸線・水深・泡の位置を 4-2c から動かさない）。minHeight〜fadeHeight で効きを 0 → 1
   */
  erosion: {
    enabled: true,
    /** 格子が覆う一辺（m、原点中心）。島の外周（約 3420m）+ 余裕 */
    extent: 7400,
    resolution: 256,
    minHeight: 5,
    fadeHeight: 20,
    /** 乱数のシード（TERRAIN_CONFIG.seed に足す） */
    seedOffset: 7,
    droplets: 28000,
    maxSteps: 30,
    inertia: 0.05,
    capacity: 8,
    minCapacity: 0.01,
    erodeRate: 0.4,
    depositRate: 0.3,
    evaporate: 0.02,
    gravity: 4,
    radius: 1,
    heightScale: 600,
    /**
     * 浸食の差分を [1, 2, 1] / 4 で縦横にならす回数（4-8）。0 だと格子 1〜2 マスの堆積の段が山腹に
     * 等高線のような縞として見えた。補間は 3 次 B スプライン（4-6 までは Catmull-Rom）
     */
    smoothPasses: 1,
    /** 風下の堆積を (1 + leeDeposit)、風上を (1 − windwardLoss) 倍に（波が土を運び去る / 浜に寄せる） */
    leeDeposit: 0.6,
    windwardLoss: 0.6,
  },
  /**
   * 高さ（と傾き）に応じた頂点カラー（sRGB）。各帯の境目は blend m かけてなめらかに混ぜる
   */
  colors: {
    seabed: 0x8a7d5c,
    sand: 0xd8c690,
    grass: 0x5d8a3c,
    forest: 0x2c4a22,
    rock: 0x7a7266,
    snow: 0xf2f4f7,
    /** 砂浜の上端・岩→雪 の高さ。森は 4-6 から木の配置と同じ密度（src/data/vegetation.ts）、岩は森の上から */
    sandTop: 4,
    rockStart: 400,
    snowStart: 515,
    blend: 25,
    /** 法線の y がこれより小さい（急斜面）と岩にする。0.75 で約 41° */
    steepNormalY: 0.75,
    /** 頂点ごとの明るさのばらつき（±割合）。のっぺり感を減らす */
    jitter: 0.06,
  },
  lod: {
    /**
     * LOD を選ぶブロックの一辺（4-7）。チャンク（2000m）を 4 × 4 に分け、ブロックごとに段を選んで
     * チャンク 1 枚のジオメトリにまとめる（draw call はチャンクの数のまま）
     */
    blockSize: 500,
    /**
     * LOD 段ごとのブロック一辺の分割数（0 が最も細かい）。500m / 64 = 約 7.8m 間隔。
     * 4-6 まではチャンク 2000m を [128, 64, 32, 16]（約 16 / 31 / 62 / 125m）で、4-7 で約 8m の段を足した
     */
    segments: [64, 32, 16, 8, 4],
    /** 段 0（約 8m）を使う距離（描画距離に依らない。4-7） */
    fineDistance: 800,
    /**
     * 段 1 以降を使う距離の上限（描画距離に対する比）。最後の段は描画距離まで、その先は描かない。
     * 距離はカメラからブロックの箱（高さの範囲を含む）までの最短距離。画質「中」（5000m）で
     * 1200 / 2400 / 3500m。地表 30m の最悪の場所で地形の三角形が約 23 万（予算 25 万）
     */
    distanceRatios: [0.24, 0.48, 0.7],
    /** 段が変わる境目で行ったり来たりしないよう、粗くするときだけこの距離だけ余分に待つ */
    hysteresis: 100,
  },
} as const;

export const WORLD_CONFIG = {
  /**
   * 起動時の位置。島の沖合（海岸から約 1.9km、山頂から 4.5km）、高度 500m。
   * 初期姿勢は -Z（島の方向）向き。画質「低」の霧（4-1 から 2700m で消える。従来は 2100m）でも海岸が見える距離
   */
  start: { x: 0, y: 500, z: 4500 },
} as const;

// 地形の質感（TERRAIN_DETAIL_CONFIG）は 4-9 で src/data/terrain-detail.ts に分けた（300 行を超えたため）
export { TERRAIN_DETAIL_CONFIG } from './terrain-detail';

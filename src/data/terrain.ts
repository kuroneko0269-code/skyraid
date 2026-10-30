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

/**
 * 地形の質感（4-1 → 4-6。画質「中」以上。描画は src/render/terrain-material.ts / terrain-layers-glsl.ts）。
 * 傾斜と高さで層（砂浜 / 草地 / 森 / 岩 / 崖 / 雪）をシェーダーの中で切り替え、層ごとに違う粒の大きさの
 * 三面マッピングの手続きノイズで明るさをばらつかせる。テクスチャ画像は使わない。
 * 「低」は従来どおり頂点カラー（TERRAIN_CONFIG.colors）の Lambert
 */
export const TERRAIN_DETAIL_CONFIG = {
  /**
   * 層の色の彩度（4-7）。下の colors を輝度のまわりにこの割合へ縮めて使う（0.65 = 35% 下げる）。
   * 実機で草地・森が鮮やかすぎて写真に見えなかった
   */
  saturation: 0.65,
  /** 層の色（sRGB。PBR の反射率。saturation を掛ける前の値） */
  colors: {
    seabed: 0x8a7d5c,
    sand: 0xd2bf8c,
    grass: 0x587a36,
    /** 森の地面（木の下の暗い緑）。forestLight とまだらに混ぜる */
    forest: 0x1e3417,
    forestLight: 0x30491f,
    /** 森の上・岩の下の高原（草と岩屑） */
    alpine: 0x7d8457,
    rock: 0x77706a,
    /** 崖の縞（地層）: 明るい層と暗い層 */
    cliff: 0x9a8c7a,
    cliffDark: 0x6e6254,
    snow: 0xf2f4f7,
    /** 草地のむら（4-7）: 乾いた草（黄茶）・湿った草（濃緑）・土が出た斜面（茶） */
    grassDry: 0x8a8550,
    grassWet: 0x3b5a2a,
    soil: 0x5b4834,
  },
  /**
   * 草地の大きなむら（4-7）。一辺 cellLarge m と cellSmall m の値ノイズを混ぜた値で 乾いた草 ⇄ 湿った草 を
   * dryFrom〜dryTo で切り替え、傾斜 soilSlopeFrom〜soilSlopeTo 度の斜面で別のノイズが soilFrom を超える所に土を出す
   */
  patches: {
    cellLarge: 800,
    cellSmall: 300,
    dryFrom: 0.3,
    dryTo: 0.7,
    soilSlopeFrom: 10,
    soilSlopeTo: 26,
    soilFrom: 0.45,
    soilTo: 0.7,
    /** 土の最大の混ぜ具合（斜面でも草が少し残る） */
    soilMax: 0.85,
  },
  /**
   * 草地の細かい荒れ（4-7）: 一辺 cell m の明暗（± amplitude）と、ノイズが soilFrom を超える所の土の点。
   * fadeStart〜fadeEnd m で消す
   */
  grassRough: {
    cell: 1.6,
    amplitude: 0.22,
    soilFrom: 0.72,
    soilAmount: 0.6,
    fadeStart: 150,
    fadeEnd: 400,
  },
  /**
   * 砂浜の上端の高さ（上限）。風上（崖の海岸）は低く、風下（遠浅の浜）は高い。
   * 4-8 から砂浜の幅は下の sandBand（海岸線からの距離）で決め、これは崖の上・低地に砂を出さないための上限
   */
  sandTop: { windward: 2.5, leeward: 8 },
  /**
   * 砂浜の幅（4-8）: 海岸線（水深 0。4-2c の水深の格子から焼いた距離）から風上 windward m・風下 leeward m までを
   * 砂にし、その先 transition m で草地へ。境目はノイズで ±jitter m ずらす。
   * 4-7 までは高さ（風下 8m）だけで決めていて、風下の遠浅の浜（4-6 で 55% 低くした）で砂が 150〜200m 内陸まで広がった
   */
  sandBand: { windward: 30, leeward: 80, transition: 50, jitter: 10 },
  /** 森の層の色を出す範囲（木の配置 VEGETATION_CONFIG と同じ条件 + 境目のぼかし m・度） */
  forestBlend: { height: 15, slopeDeg: 4 },
  /** 高原（alpine）が始まる高さ・岩が始まる高さ */
  alpineStart: 340,
  rockStart: 400,
  /** 傾斜で岩・崖にする角度（度）。境目は ±slopeBlend 度でぼかす */
  rockSlopeDeg: 30,
  cliffSlopeDeg: 50,
  slopeBlendDeg: 3,
  /** 境目を乱すノイズ: 大小 2 枚（一辺 m）。高さの境目は ±heightJitter m、傾斜の境目は ±slopeJitter 度ずらす */
  boundaryNoise: { large: 37, small: 9, heightJitter: 14, slopeJitter: 5 },
  /** 崖の縞: 間隔（m）、高さ方向のうねり（m）、明暗の強さ */
  strata: { spacing: 4.5, warp: 3.5, contrast: 0.3 },
  /**
   * 雪: 雪線の高さ。北向き（+Z。太陽の反対側で日陰になる）の斜面ほど northBias m 下がり、境目はノイズで ±noise m。
   * 傾斜 maxSlopeDeg を超える急斜面には積もらない
   */
  snow: {
    start: 515,
    northBias: 80,
    noise: 25,
    maxSlopeDeg: 45,
    north: { x: 0, z: 1 },
    /**
     * 4-7: 傾斜 rockFrom〜rockTo 度で雪が薄くなり、ノイズ（一辺 rockCell m）に沿って岩が透ける。
     * 風下（src/data/wind.ts の風が吹いていく向きを向く斜面）は吹きだまりで雪線が driftLower m 下がり、
     * 岩が透けにくく（driftCover の割合だけ）、積もる傾斜の上限も driftSlope 度上がる
     */
    rockFrom: 20,
    rockTo: 40,
    rockCell: 6,
    driftLower: 60,
    driftCover: 0.6,
    driftSlope: 8,
    /**
     * 色: 日陰（太陽の向きとの内積が shadeTo より小さい）は青みがかった灰色、日向は少し暖色（反射率に掛ける）
     */
    shadeTint: [0.8, 0.86, 0.98],
    sunTint: [1.0, 0.98, 0.93],
    shadeTo: 0.3,
  },
  /**
   * 粒（三面マッピングの値ノイズ）: 細かい（一辺 fine m）・粗い（coarse m）・まだら（mottle m）の 3 枚を、
   * 層ごとの強さ（± 割合）で混ぜる。岩は粗く、草は細かく。fade は消え始め〜消えきる距離
   */
  grain: {
    fine: { cell: 0.8, fadeStart: 100, fadeEnd: 300 },
    coarse: { cell: 3.5, fadeStart: 250, fadeEnd: 800 },
    mottle: { cell: 14, fadeStart: 700, fadeEnd: 2000 },
    /** 層ごとの [fine, coarse, mottle] の強さ */
    sand: [0.12, 0.05, 0.08],
    grass: [0.28, 0.08, 0.16],
    forest: [0.1, 0.3, 0.35],
    alpine: [0.2, 0.18, 0.15],
    rock: [0.08, 0.35, 0.2],
    cliff: [0.06, 0.25, 0.15],
    snow: [0.03, 0.06, 0.05],
  },
  /** 大きな色むら（真上から投影。遠くまで残す）。草地の黄緑〜深緑の揺らぎ */
  macro: { cell: 60, amplitude: 0.12, fadeStart: 2500, fadeEnd: 4500 },
  /**
   * 法線の細部（QualityPreset.terrainNormalDetail）: 岩・崖の面を手続きノイズの勾配で揺らす。
   * 粗い凹凸（一辺 coarse m・高さ ±coarseDepth m）と細かい凹凸、崖は縞の段差（strataDepth m）も足す
   */
  normal: {
    /**
     * 4-7: すべての層に 2 段の凹凸（真上から投影）。大: 一辺 large m・高さ ±largeDepth m（largeFade m で消す）、
     * 小: 一辺 small m・±smallDepth m（smallFade m で消す）。雪は一辺 snow m の細かい凹凸も足す
     */
    large: 30,
    largeDepth: 2.5,
    largeFade: [900, 2000],
    small: 3,
    smallDepth: 0.22,
    smallFade: [150, 450],
    snow: 1.7,
    snowDepth: 0.1,
    snowFade: [100, 350],
    coarse: 4.5,
    coarseDepth: 1.2,
    fine: 1.3,
    fineDepth: 0.25,
    strataDepth: 0.25,
    fadeStart: 250,
    fadeEnd: 900,
  },
  /** 地形の粗さ（PBR）。草地・岩はほぼ完全な拡散面、雪は少しだけ艶 */
  roughness: 0.95,
} as const;

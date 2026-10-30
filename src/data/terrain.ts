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
  },
  /**
   * 高さ（と傾き）に応じた頂点カラー（sRGB）。各帯の境目は blend m かけてなめらかに混ぜる
   */
  colors: {
    seabed: 0x8a7d5c,
    sand: 0xd8c690,
    grass: 0x5d8a3c,
    forest: 0x3f6a2e,
    rock: 0x7a7266,
    snow: 0xf2f4f7,
    /** 砂浜の上端・草地→森・森→岩・岩→雪 の高さ */
    sandTop: 4,
    forestStart: 90,
    rockStart: 260,
    snowStart: 470,
    blend: 25,
    /** 法線の y がこれより小さい（急斜面）と岩にする。0.75 で約 41° */
    steepNormalY: 0.75,
    /** 頂点ごとの明るさのばらつき（±割合）。のっぺり感を減らす */
    jitter: 0.06,
  },
  lod: {
    /** LOD 段ごとのチャンク一辺の分割数（0 が最も細かい）。2000m / 128 = 約 16m 間隔 */
    segments: [128, 64, 32, 16],
    /**
     * 段 i を使う距離の上限（描画距離に対する比）。最後の段は描画距離まで、その先は描かない。
     * 距離はカメラからチャンクの箱（高さの範囲を含む）までの最短距離
     */
    distanceRatios: [0.12, 0.3, 0.6],
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
 * 地形の近距離のディテール（4-1。画質「中」以上）。三面マッピング（triplanar）の手続きノイズで
 * 頂点カラーの明るさをばらつかせ、草・岩の粒を出す。テクスチャ画像は使わない。描画は src/render/terrain-material.ts
 */
export const TERRAIN_DETAIL_CONFIG = {
  /** 細かい粒（草・小石）: ノイズの一辺（m）、明るさのばらつき（±割合）、消える距離（m） */
  fine: { cell: 1.5, amplitude: 0.25, fadeStart: 120, fadeEnd: 380 },
  /** 中くらいのまだら（草むら・岩の割れ目） */
  medium: { cell: 8, amplitude: 0.2, fadeStart: 500, fadeEnd: 1400 },
  /** 大きな色むら（真上から投影。遠くまで残す）。草地の黄緑〜深緑の揺らぎ */
  macro: { cell: 60, amplitude: 0.12, fadeStart: 2500, fadeEnd: 4500 },
  /** 急斜面（岩）の粒を強くする倍率。法線の y が rockNormalY より小さいほど岩扱い */
  rockBoost: 1.6,
  rockNormalY: { from: 0.85, to: 0.65 },
  /** 地形の粗さ（PBR）。草地・岩はほぼ完全な拡散面 */
  roughness: 0.95,
} as const;

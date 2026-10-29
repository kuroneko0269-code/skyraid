// 島の地形・海面・空のパラメータ（1-3）。高さの計算は src/render/terrain-height.ts、
// メッシュと LOD は src/render/terrain.ts。距離・高さは m

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

export const OCEAN_CONFIG = {
  /** 平面の分割数（一辺）。平面の一辺は描画距離 × 2 */
  segments: 64,
  /** 波（ワールド座標で計算）。振幅 m・波長 m・速さ m/s・向き（度、+X から +Z へ） */
  waves: [
    { amplitude: 0.9, wavelength: 260, speed: 6, direction: 20 },
    { amplitude: 0.6, wavelength: 170, speed: 4.5, direction: 75 },
    { amplitude: 0.35, wavelength: 110, speed: 3.5, direction: -40 },
  ],
  /** 細かいさざ波は頂点を動かさず、法線だけ揺らす（波長 m） */
  rippleWavelengths: [23, 13, 7.5],
  rippleStrength: 0.08,
  /** さざ波を距離で消す範囲（m）。遠くでモアレ・ちらつきにならないように */
  rippleFade: { start: 150, end: 700 },
  /** 真下を見たときの水の色と、フレネルで混ぜる空の反射の強さ（0〜1） */
  deepColor: 0x0f3a55,
  shallowColor: 0x1d6378,
  reflectivity: 0.85,
  /** 太陽の照り返しの鋭さと強さ */
  sunShininess: 500,
  sunSpecular: 1.0,
  /**
   * 画質「低」（QualityPreset.oceanSimple）の簡略版: 頂点の波は waves の先頭 waveCount 本だけ、
   * さざ波なし、水の色とフレネルは頂点で計算（太陽の照り返しだけ画素ごと）
   */
  simple: { waveCount: 1 },
} as const;

export const SKY_CONFIG = {
  /** 天頂の色と地平線の色（sRGB）。霧の色は地平線の色に合わせる */
  zenithColor: 0x2f6bb8,
  horizonColor: 0xbcd3e6,
  /** グラデーションの曲がり方。1 未満で地平線付近の明るい帯が細くなる */
  exponent: 0.55,
  /** ドームの半径。深度テストなしで最初に描くので、far より小さければよい */
  radius: 1000,
  sun: {
    /** 太陽の方向（方位は -Z（初期の進行方向）から右回り、仰角は地平線から。度） */
    azimuth: 40,
    elevation: 32,
    color: 0xfff1d6,
    /** 太陽の円盤の大きさ（視角の半径、度）と、まわりの光のにじみ */
    discRadius: 1.2,
    glowStrength: 0.5,
    glowExponent: 60,
    /** 平行光源の強さ（1-1 と同じ） */
    lightIntensity: 2.0,
  },
} as const;

export const WORLD_CONFIG = {
  /**
   * 起動時の位置。島の沖合（海岸から約 1.9km、山頂から 4.5km）、高度 500m。
   * 初期姿勢は -Z（島の方向）向き。画質「低」の霧（2100m で消える）でも海岸が見える距離
   */
  start: { x: 0, y: 500, z: 4500 },
} as const;

// 木（4-6）。配置は src/render/terrain-gen/forest.ts、描画は src/render/vegetation.ts。
// 本数は画質で変える（src/data/quality.ts の treeCount）。距離・高さは m

export const VEGETATION_CONFIG = {
  /** 配置の乱数のシード（TERRAIN_CONFIG.seed に足す） */
  seedOffset: 101,
  /**
   * 森の密度（0〜1）。値ノイズ 2 枚（大きな林のまとまり + 小さな切れ目）を混ぜ、from〜to で 0 → 1。
   * 同じ式を地形のシェーダー（森の層の地面の色）でも使う
   */
  density: { cellLarge: 420, cellSmall: 95, weightLarge: 0.65, from: 0.38, to: 0.62 },
  /** 森の層: この高度の範囲で、傾斜がこの角度以下の所にだけ木を置く */
  minHeight: 20,
  maxHeight: 350,
  maxSlopeDeg: 25,
  /** 傾斜を測る差分の間隔 */
  slopeStep: 6,
  /** 候補を撒く範囲の半径（島の外周 約 3420m を含む） */
  radius: 3500,
  /** 候補の数の上限（本数 × この倍率）。足りなければそこで打ち切る */
  maxAttemptsPerTree: 40,
  /** 近くの木（InstancedMesh の円錐 + 円柱）を描く距離。その先は十字ビルボード */
  nearDistance: 600,
  /** 近くの木の集合は、カメラが nearRefresh 動くごとに nearDistance + nearRefresh の範囲で選び直す */
  nearRefresh: 50,
  /**
   * 束（4-7。画質「中」以上 = QualityPreset.treeClumps）: 1 候補ごとに min〜max 本を、中心から spacing m
   * ほど離して輪に並べる。近景で木が「点」ではなく「面」に見えるように
   */
  clump: { min: 3, max: 5, spacing: { min: 5, max: 9 } },
  /**
   * 木の大きさ: 高さ（幅は高さ × crownRatio）。4-7 で 1.3 倍（11〜23 → 14.3〜29.9m）。
   * 4-9: 森の密集部は mean m の ±variation（16.6〜27.6m）にし、下の edge で縁ほど低くする
   */
  height: { mean: 22.1, variation: 0.25 },
  /**
   * 森の縁（4-9）: 森の密度（0〜1）が densityFull 未満の所は高さを最小 heightMin 倍まで下げ、
   * 置く確率を 密度 ^ acceptPower にする（4-6〜4-8 は密度に比例 = 1）。森の輪郭をなめらかに
   */
  edge: { densityFull: 0.85, heightMin: 0.55, acceptPower: 1.6 },
  crownRatio: { min: 0.32, max: 0.45 },
  /** 根元を地面に沈める深さ（地形の LOD の直線補間で浮かないように） */
  sink: 1.5,
  /** 色（sRGB）。葉は木ごとに明るさ ±lightness、黄み ±hue だけばらつかせる */
  colors: {
    /** 4-9: 明度（HSL）を +25%（#30492a → #3c5b35）。遠景で真っ黒な三角に見えた */
    foliage: 0x3c5b35,
    foliageLight: 0x5c7c3c,
    trunk: 0x4a3a2a,
    /**
     * 遠景のビルボードの葉の色（4-7。4-6 までは foliageLight）。地形の森の層（TERRAIN_DETAIL_CONFIG.colors の
     * forest / forestLight）と同じ系統の暗い緑にし、彩度も地形と同じだけ下げる。4-9 で明度 +25%（#34502a → #416435）
     */
    billboard: 0x416435,
    lightness: 0.18,
    /**
     * 近くの木の個体差（4-8）: 葉と幹を別々に、明るさ ±lightness（割合）・色相 ±hueDeg 度ずらす。
     * 4-7 までは近くの木も葉と幹まとめて明るさ ±lightness（上の 0.18）だけで、色相が同じ木が並んで見えた。
     * 遠くのビルボードは上の lightness のまま
     */
    nearVariation: { lightness: 0.1, hueDeg: 10 },
  },
  /**
   * 空の環境光（4-9）: 4-10 の機体の環境マップ（大気散乱の空の PMREM）を木にも付ける強さ。
   * 葉の法線は上へ normalUp だけ曲げ（葉の塊として空を向く）、影側も空の色で照らす。
   * 遠景のビルボードの法線は 上 + カメラの向き × towardCamera（4-8 までは 0.35）
   */
  environment: { intensity: 0.9, roughness: 1, normalUp: 0.5, towardCamera: 0.6 },
  /**
   * 近くの木の形（4-9）: 少しずつずらした円錐 tiers 段（下から [底の高さ, 上の高さ, 半径, ずれ]、高さ・幅 1 の割合）+
   * 最上段の頂点の手前 roundAt（段の高さの割合）で半径 roundRadius 倍の輪を足して丸める。周 segments 分割、
   * 幹は trunkSegments 角柱。三角形は 幹 2 × 3 + 下 2 段 5 + 5 + 最上段 5 × 3 = 31（4-8 までは 26）。
   * 周 6 分割（36）は「中」の森の上空で木の三角形が +27% になり、上限（+20%）を超えた
   */
  nearShape: {
    segments: 5,
    trunkSegments: 3,
    trunkTop: 0.22,
    tiers: [
      [0.14, 0.58, 0.5, 0.035],
      [0.38, 0.8, 0.39, 0.03],
      [0.6, 1.0, 0.27, 0.02],
    ],
    roundAt: 0.72,
    roundRadius: 0.42,
  },
  /**
   * 遠くのビルボードの樹冠（4-9。4-8 までは尖った三角形）: 手続き生成のテクスチャ（一辺 tileSize px の
   * タイル。種類 types × [1 本・束] の縦の輪郭 + 上から見た輪郭）。種類は束ごとに乱数で選ぶ
   */
  crowns: { types: 3, tileSize: 64 },
  /** 風の揺れ（近くの木だけ）: 梢の振れ幅（m）と速さ（rad/s）。向きは src/data/wind.ts */
  sway: { amplitude: 0.35, speed: 1.4 },
  /** 遠くのビルボードの葉の形: 輪郭のノイズの強さ */
  billboardEdgeNoise: 0.18,
  /**
   * 木の影の代わり（画質「高」のみ）: 地面の点から太陽の方へ木の高さ × length だけ先の森の密度で直射光を
   * 最大 strength 暗くする。4-9: まだら（4-6 は一辺 5m のノイズ）を樹冠の形に。一辺 cell m の格子ごとに
   * 密度の確率で木を置き、半径 crown（格子の割合。約 4m）の円を太陽の向きへ伸ばした楕円の影
   */
  shade: { length: 0.8, cell: 9, crown: 0.45, strength: 0.5, fadeEnd: 2500 },
} as const;

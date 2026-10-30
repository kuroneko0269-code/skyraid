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
  /** 木の大きさ: 高さ（幅は高さ × crownRatio）。木ごとにばらつかせる。4-7 で 1.3 倍（11〜23 → 14.3〜29.9m） */
  height: { min: 14.3, max: 29.9 },
  crownRatio: { min: 0.32, max: 0.45 },
  /** 根元を地面に沈める深さ（地形の LOD の直線補間で浮かないように） */
  sink: 1.5,
  /** 色（sRGB）。葉は木ごとに明るさ ±lightness、黄み ±hue だけばらつかせる */
  colors: {
    foliage: 0x30492a,
    foliageLight: 0x5c7c3c,
    trunk: 0x4a3a2a,
    /**
     * 遠景のビルボードの葉の色（4-7。4-6 までは foliageLight）。地形の森の層（TERRAIN_DETAIL_CONFIG.colors の
     * forest / forestLight）と同じ系統の暗い緑にし、彩度も地形と同じだけ下げる
     */
    billboard: 0x34502a,
    lightness: 0.18,
    /**
     * 近くの木の個体差（4-8）: 葉と幹を別々に、明るさ ±lightness（割合）・色相 ±hueDeg 度ずらす。
     * 4-7 までは近くの木も葉と幹まとめて明るさ ±lightness（上の 0.18）だけで、色相が同じ木が並んで見えた。
     * 遠くのビルボードは上の lightness のまま
     */
    nearVariation: { lightness: 0.1, hueDeg: 10 },
  },
  /** 風の揺れ（近くの木だけ）: 梢の振れ幅（m）と速さ（rad/s）。向きは src/data/wind.ts */
  sway: { amplitude: 0.35, speed: 1.4 },
  /** 遠くのビルボードの葉の形: 輪郭のノイズの強さ */
  billboardEdgeNoise: 0.18,
  /**
   * 木の影の代わり（画質「高」のみ）: 地面の点から太陽の方へ木の高さ × length だけ先の森の密度 ×
   * まだら（一辺 cell m のノイズ）で直射光を最大 strength 暗くする
   */
  shade: { length: 0.8, cell: 5, strength: 0.5, fadeEnd: 2500 },
} as const;

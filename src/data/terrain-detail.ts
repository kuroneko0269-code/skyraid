// 地形の質感のパラメータ（4-1 → 4-6 → 4-7 → 4-9。4-9 で src/data/terrain.ts から分けた）。距離・高さは m

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
    /**
     * 草地のむら（4-7）: 乾いた草・湿った草（濃緑）・土が出た斜面（茶）。
     * 4-9: 乾いた草を黄茶 #8a8550 から緑がかった枯れ色に（低地が薄黄色で平坦に見えた）
     */
    grassDry: 0x737a4a,
    grassWet: 0x3b5a2a,
    soil: 0x5b4834,
    /** 低地の湿地・濃い草地のパッチ（4-9） */
    wetland: 0x2f4a26,
  },
  /**
   * 草地の大きなむら（4-7）。一辺 cellLarge m と cellSmall m の値ノイズを混ぜた値で 乾いた草 ⇄ 湿った草 を
   * dryFrom〜dryTo で切り替え、傾斜 soilSlopeFrom〜soilSlopeTo 度の斜面で別のノイズが soilFrom を超える所に土を出す
   */
  patches: {
    cellLarge: 800,
    cellSmall: 300,
    dryFrom: 0.3,
    /**
     * 乾いた草に切り替わる範囲（4-9。4-7 は 0.5〜0.7）。乾いた草の面積の割合（重みの平均）を
     * 0.42 → 約 0.25（約 60%）に下げた。下の mid を足した値で測る
     */
    dryStart: 0.575,
    dryTo: 0.775,
    soilSlopeFrom: 10,
    soilSlopeTo: 26,
    soilFrom: 0.45,
    soilTo: 0.7,
    /** 土の最大の混ぜ具合（斜面でも草が少し残る） */
    soilMax: 0.85,
  },
  /**
   * 草地の中間スケールのむら（4-9）: 一辺 cellLarge m と cellSmall m の値ノイズ（20〜60m の模様）を
   * 乾き具合に ±weight/2 だけ足し、明るさを ±brightness 揺らす。距離 200〜1000m の草地に変化を出す。
   * fadeStart〜fadeEnd m で消す（遠くのちらつき防止）
   */
  midPatches: {
    cellLarge: 55,
    cellSmall: 22,
    weight: 0.3,
    brightness: 0.08,
    fadeStart: 1800,
    fadeEnd: 3200,
  },
  /**
   * 低地の湿地・濃い草地（4-9）: 一辺 cell m の値ノイズが from〜to の所を colors.wetland へ最大 max まで混ぜる
   * （パッチは 150〜400m）。高さ maxHeight m（± heightBlend）より下・傾斜 maxSlopeDeg 度以下の平らな低地だけ
   */
  wetland: {
    cell: 260,
    from: 0.62,
    to: 0.74,
    max: 0.85,
    maxHeight: 70,
    heightBlend: 30,
    maxSlopeDeg: 10,
  },
  /**
   * 砂浜と草地の境目の「草の生えた砂」の帯（4-9）: 砂浜の内側の端から海側へ width m を、砂と乾いた草を
   * grass の割合で混ぜた色にし、一辺 tuft m のノイズで草の株をまだらに出す。色の段差を和らげる
   */
  grassySand: { width: 15, grass: 0.45, tuft: 3.5 },
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

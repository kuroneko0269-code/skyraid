// 9-6a: ネフィルガの形の生成の数値。生成器は src/render/kaiju2-model/。画像ファイルは使わない（手続き生成）。
// 三角形は「高」15,000 以下・「低」5,000 以下（tests/kaiju2.test.ts）。ヴォルガス（高 18,532・低 3,934。9-6a の計測）より軽くする

export interface Kaiju2DetailSpec {
  /** 管（胴・首・尾・翼の骨・脚）の断面の分割数 */
  readonly radial: number;
  /** 管の長さ方向の分割の倍率 */
  readonly rings: number;
  /** 翼の膜の分割（翼の付け根 → 先・前縁 → 後縁） */
  readonly membraneSpan: number;
  readonly membraneChord: number;
}

export const KAIJU2_MODEL_CONFIG = {
  detail: {
    high: { radial: 16, rings: 2, membraneSpan: 34, membraneChord: 10 },
    low: { radial: 8, rings: 1, membraneSpan: 14, membraneChord: 4 },
  } satisfies Record<'high' | 'low', Kaiju2DetailSpec>,
  colors: {
    /**
     * 背: 暗い青灰、腹: 骨のような明るい灰白、膜: 深い藍（10-7a で背と腹の明るさを入れ替えた。9-6a は背 0x9a968c・腹 0x6f6a62）。
     * horn: 角・とさか・爪（骨の色）
     */
    back: 0x3b3f4a,
    belly: 0xb9b2a2,
    dark: 0x1c1d22,
    horn: 0xd8d0bc,
    membrane: 0x2a2350,
    membraneEdge: 0x120f26,
    /** 目（淡い黄）・喉の袋と膜の筋（雷の紫白） */
    eye: 0xffe58a,
    storm: 0xb9a6ff,
    orb: 0xcfc2ff,
    gust: 0xdde8ff,
  },
  /** 発光: 目の明るさ・膜の筋の常時と予兆の最大・喉の袋の常時と最大 */
  glow: { eye: 2.2, veinIdle: 0.35, veinMax: 3.2, throatIdle: 0.2, throatMax: 6 },
  /**
   * 羽ばたきの振れ幅（ラジアン）・掲げる量と、たたむ量（9-6b で整えた。骨ごとの水平の回転: 上腕を後ろへ 38°・前腕を前へ 79°・
   * 指を後ろへ 124° 折り返し、上から見て上腕 50° 後ろ・前腕 60° 前・指 125° 後ろの「Z」で体の横に寄せる。lift は上への持ち上げ）
   */
  flap: {
    amplitude: 0.62,
    raise: 0.9,
    foldShoulder: 0.66,
    foldElbow: 1.38,
    foldWrist: 2.16,
    foldLift: 0.18,
  },
  /** 9-6b: 被弾で白く光る明るさ（emissive）・壊れた部位の骨の縮み（翼の指 = 膜が裂けて短くなる・尾の先）と翼の垂れ（ラジアン） */
  hitFlash: 0.55,
  broken: { wingScale: 0.5, wingDroop: 0.35, tailScale: 0.45 },
  /** 雷球の見た目の半径（判定の半径の倍率）・突風の輪の不透明度 */
  orbScale: 0.55,
  gustOpacity: 0.35,
} as const;

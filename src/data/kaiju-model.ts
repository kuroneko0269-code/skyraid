// 怪獣の形の生成の数値（6-1）。生成器は src/render/kaiju-model/。画像ファイルは使わない（手続き生成）。
// 「高」は三角形 40,000 以下、「低」（AircraftDetail の low）は 12,000 以下（tests/kaiju-model.test.ts で確かめる）

export interface KaijuDetailSpec {
  /** 断面の周の分割数（胴・尾・脚・腕・頭） */
  readonly radial: number;
  /** 胴・尾・脚などの長さ方向の分割の倍率 */
  readonly rings: number;
  /** 結晶の塊（肩・首の付け根・前腕。6-1b）の本数の倍率と、1 本の側面の数 */
  readonly crystals: number;
  readonly crystalSides: number;
}

export const KAIJU_MODEL_CONFIG = {
  detail: {
    high: { radial: 36, rings: 1.4, crystals: 1, crystalSides: 6 },
    low: { radial: 16, rings: 0.6, crystals: 0.55, crystalSides: 4 },
  } satisfies Record<'high' | 'low', KaijuDetailSpec>,
  colors: {
    /** 皮膚: 黒〜深緑（背は黒に近く、腹はわずかに明るい緑） */
    back: 0x131d15,
    belly: 0x2b3d2b,
    claw: 0x2a2620,
    /** 溶岩のような亀裂（発光） */
    crack: 0xff3a0c,
    /** 皮膚のむらの深緑（6-1b。黒一色にしない） */
    mottle: 0x1d3a21,
    /** 4 つの目（発光。6-1b で琥珀 #ffb22e → 橙） */
    eye: 0xff5a08,
    /** 結晶（6-1b: 半透明の青い結晶。内側が光る） */
    crystal: 0x5fa8ff,
    crystalGlow: 0x3f9cff,
    /** 熱線の色（芯と外側） */
    beamCore: 0xe8f6ff,
    beamOuter: 0x58b8ff,
    rock: 0x5a5249,
  },
  /** 亀裂の明るさ（ブルームに乗る強さ）・脈打つ速さ（1/秒）・亀裂の細さ（0〜1、小さいほど細い） */
  crack: { intensity: 2.6, pulse: 0.7, width: 0.075, scale: 0.045 },
  /** 結晶の明るさ: 常時 → 熱線の直前の最大 */
  crystal: { idle: 0.7, max: 6.5, brokenScale: 0.35 },
  /**
   * 結晶の質感（6-1b）: 不透明度・屈折率（反射の強さ）・内側の光（正面を向く面ほど明るい。edge は縁の残り）。
   * transmission は使わない（追加の描画パスが要る）
   */
  crystalLook: { opacity: 0.72, ior: 1.9, roughness: 0.06, innerPower: 1.6, edge: 0.25 },
  /** 鱗の凹凸（6-1b。静止姿勢の位置の 1/m で、cell m ごとの鱗）と強さ・筋肉の起伏の強さ */
  scales: { cell: 2.2, strength: 0.9 },
  muscle: 0.1,
  eyeIntensity: 2.4,
  /** 被弾の白い光の強さ */
  flash: 0.45,
  /** 熱線の太さ（判定の幅の倍率）と、ゆらぎ */
  beam: { radiusScale: 0.5, flicker: 0.15 },
} as const;

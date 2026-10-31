// 怪獣の形の生成の数値（6-1）。生成器は src/render/kaiju-model/。画像ファイルは使わない（手続き生成）。
// 「高」は三角形 40,000 以下、「低」（AircraftDetail の low）は 12,000 以下（tests/kaiju-model.test.ts で確かめる）

export interface KaijuDetailSpec {
  /** 断面の周の分割数（胴・尾・脚・腕・頭） */
  readonly radial: number;
  /** 胴・尾・脚などの長さ方向の分割の倍率 */
  readonly rings: number;
  /** 背中の結晶の棘の数と、1 本の側面の数 */
  readonly spikes: number;
  readonly spikeSides: number;
}

export const KAIJU_MODEL_CONFIG = {
  detail: {
    high: { radial: 36, rings: 1.4, spikes: 40, spikeSides: 6 },
    low: { radial: 16, rings: 0.6, spikes: 22, spikeSides: 4 },
  } satisfies Record<'high' | 'low', KaijuDetailSpec>,
  colors: {
    /** 皮膚: 黒〜深緑（背は黒に近く、腹はわずかに明るい緑） */
    back: 0x131d15,
    belly: 0x2b3d2b,
    claw: 0x2a2620,
    /** 溶岩のような亀裂（発光） */
    crack: 0xff3a0c,
    /** 4 つの目（発光） */
    eye: 0xffb22e,
    /** 結晶の棘（青白く発光） */
    crystal: 0xa8dcff,
    crystalGlow: 0x6cc6ff,
    /** 熱線の色（芯と外側） */
    beamCore: 0xe8f6ff,
    beamOuter: 0x58b8ff,
    rock: 0x5a5249,
  },
  /** 亀裂の明るさ（ブルームに乗る強さ）・脈打つ速さ（1/秒）・亀裂の細さ（0〜1、小さいほど細い） */
  crack: { intensity: 2.6, pulse: 0.7, width: 0.075, scale: 0.045 },
  /** 結晶の明るさ: 常時 → 熱線の直前の最大 */
  crystal: { idle: 0.7, max: 6.5, brokenScale: 0.35 },
  eyeIntensity: 3.5,
  /** 被弾の白い光の強さ */
  flash: 0.45,
  /** 熱線の太さ（判定の幅の倍率）と、ゆらぎ */
  beam: { radiusScale: 0.5, flicker: 0.15 },
} as const;

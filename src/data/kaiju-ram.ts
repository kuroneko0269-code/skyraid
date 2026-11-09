// 10-4c: レイドの怪獣の体への衝突（体当たり）の共通の数値。10-5b でゼノリスにだけ先に入れた扱いを、アルビオン・ゴウライにも使う。
// 10-6: ヴォルガス・ネフィルガにも使う（形は src/ai/kaiju-hull/。5 体とも同じ扱い）

/**
 * ぶつかったら最大 HP の hpShare（約 8 割）のダメージ（残りが足りなければ撃墜 = 墜落と同じ扱い）。跳ね返さない（向き・速さ・位置は
 * そのまま。体は通り抜ける）。invulnerable 秒は続けて当たらない（通り抜ける間に何度も当たらない）
 */
export const KAIJU_RAM = {
  hpShare: 0.8,
  invulnerable: 1.5,
} as const;

/** ぶつかったと分かる見た目と音（描画・音だけ。判定には使わない） */
export const KAIJU_RAM_FX = {
  /** カメラの揺れ（2-1 の地面衝突 1.0 に対する強さ。被弾は 0.22） */
  shake: 0.85,
  /** こすれた火花の数（命中の火花の部品。1 発の命中は SPARK_CONFIG.perTargetHit） */
  sparks: 36,
  /** 火花の速さの倍率（命中の火花より強く散る） */
  sparkSpeed: 1.8,
  /** 破片の煙（暗い灰の玉）の数・広がり（m）・散る速さ（m/s）・見た目 */
  puffs: 6,
  puffSpread: 6,
  puffSpeed: 26,
  puff: { life: 1.4, start: 2, end: 9, opacity: 0.6, color: 0x3a3632 },
  /** 閃光の大きさ（m） */
  flashSize: 14,
} as const;

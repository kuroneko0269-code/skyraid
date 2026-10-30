// 強化の 4 系統（3-3）: 効果と価格。数値の掛け合わせは src/progression/loadout.ts、購入は src/progression/hangar.ts。
// 強化は機体ごとに独立（セーブの aircraft.owned[機体 id]）

/** 強化の 4 系統（エンジン / 機体 / 武装 / 電子装備） */
export const UPGRADE_KINDS = ['engine', 'airframe', 'weapons', 'avionics'] as const;
export type UpgradeKind = (typeof UPGRADE_KINDS)[number];

/** 強化レベルの範囲。Lv0 が未強化（機体そのまま）、Lv5 が最大 */
export const UPGRADE_LEVELS = { min: 0, max: 5 } as const;

/** Lv(n-1) → Lv n に上げる価格（CR）。添字 0 が Lv1。どの機体・系統も同じ */
export const UPGRADE_PRICES: readonly number[] = [500, 1000, 2000, 4000, 8000];

/**
 * 1 レベルあたりの効果。倍率は「1 + 値 × Lv」で機体の値に掛ける（Lv5 で 値 × 5）。数は Lv ごとに足す
 * - エンジン Lv5: 最高速 +20%・加速 +25%・アフターバーナーの持続 +50%
 * - 機体 Lv5: HP +50%・旋回 +15%
 * - 武装 Lv5: 機銃のダメージ +50%（12 → 18。敵機 HP 120 を 10 発 → 7 発。4-12 で基準値を 10 → 12）・ミサイル +5
 * - 電子装備 Lv5: ロック時間 −40%（1.2 → 0.72 秒）・索敵距離 +30%（5000 → 6500m）・フレア +5
 */
export const UPGRADE_EFFECTS = {
  engine: { topSpeed: 0.04, accel: 0.05, afterburnerDuration: 0.1 },
  airframe: { hp: 0.1, turn: 0.03 },
  weapons: { gunDamage: 0.1, missiles: 1 },
  avionics: { lockTime: -0.08, sensorRange: 0.06, flares: 1 },
} as const;

/** ハンガーに出す名前と効果の説明 */
export const UPGRADE_INFO: Readonly<Record<UpgradeKind, { label: string; effect: string }>> = {
  engine: { label: 'エンジン', effect: '最高速・加速・AB 持続' },
  airframe: { label: '機体', effect: 'HP・旋回' },
  weapons: { label: '武装', effect: '機銃ダメージ・ミサイル +1' },
  avionics: { label: '電子装備', effect: 'ロック時間・索敵距離・フレア +1' },
};

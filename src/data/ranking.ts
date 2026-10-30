// ミッションの評価（2-4）: クリア時間と被弾量から S / A / B / C を決める。報酬 = 基本額 × ランク倍率
// 式（点数は 100 点満点）:
//   時間の減点 = timeWeight × clamp((クリア時間 / 基準時間 − 1) / (timeZeroRatio − 1), 0, 1)
//   被弾の減点 = damageWeight × clamp((被弾量 / 最大 HP) / damageZeroRatio, 0, 1)
//   任意目標の加点 = optionalWeight × 達成した任意目標の数 / 任意目標の数（任意目標がなければ 0。3-2）
//   点数 = min(100, 100 − 時間の減点 − 被弾の減点 + 任意目標の加点) → thresholds で S / A / B、それ未満は C
// 基準時間はミッションごと（MissionDef.parTimeSeconds）

export const RANKS = ['S', 'A', 'B', 'C'] as const;
export type Rank = (typeof RANKS)[number];

export const RANKING_CONFIG = {
  /** 時間の減点の最大。基準時間ちょうどなら 0、基準時間の timeZeroRatio 倍で最大 */
  timeWeight: 50,
  timeZeroRatio: 2,
  /** 被弾の減点の最大。最大 HP の damageZeroRatio 倍を受けると最大（HP は回復しないので 1 で「瀕死」） */
  damageWeight: 50,
  damageZeroRatio: 1,
  /**
   * 任意目標をすべて達成したときの加点（3-2）。減点を取り返す分だけで、100 点は超えない。
   * 1 ランクの幅（15〜20 点）より小さくし、任意目標だけでランクが 2 つ上がらないようにする
   */
  optionalWeight: 10,
  /** この点数以上でそのランク */
  thresholds: { S: 90, A: 75, B: 55 },
} as const;

/** ランク別の報酬倍率の既定値（ミッションの定義で上書きできる） */
export const DEFAULT_RANK_MULTIPLIERS: Readonly<Record<Rank, number>> = {
  S: 2,
  A: 1.5,
  B: 1.2,
  C: 1,
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** 任意目標の達成数（加点用）。total が 0 なら加点なし */
export interface OptionalTally {
  readonly completed: number;
  readonly total: number;
}

const NO_OPTIONAL: OptionalTally = { completed: 0, total: 0 };

/** 評価の点数（0〜100） */
export function rankScore(
  clearSeconds: number,
  parSeconds: number,
  damageTaken: number,
  maxHp: number,
  optional: OptionalTally = NO_OPTIONAL,
  config = RANKING_CONFIG,
): number {
  const timeRatio = parSeconds > 0 ? clearSeconds / parSeconds : 1;
  const timePenalty = config.timeWeight * clamp01((timeRatio - 1) / (config.timeZeroRatio - 1));
  const damageRatio = maxHp > 0 ? damageTaken / maxHp : 0;
  const damagePenalty = config.damageWeight * clamp01(damageRatio / config.damageZeroRatio);
  const bonus =
    optional.total > 0 ? config.optionalWeight * clamp01(optional.completed / optional.total) : 0;
  return Math.min(100, 100 - timePenalty - damagePenalty + bonus);
}

/** 点数からランク */
export function rankFromScore(score: number, config = RANKING_CONFIG): Rank {
  const t = config.thresholds;
  if (score >= t.S) return 'S';
  if (score >= t.A) return 'A';
  if (score >= t.B) return 'B';
  return 'C';
}

/** クリア時間・被弾量・任意目標の達成からランク */
export function computeRank(
  clearSeconds: number,
  parSeconds: number,
  damageTaken: number,
  maxHp: number,
  optional: OptionalTally = NO_OPTIONAL,
): Rank {
  return rankFromScore(rankScore(clearSeconds, parSeconds, damageTaken, maxHp, optional));
}

/** 報酬 = 基本額 × ランク倍率（整数に丸める） */
export function rewardCredits(
  baseCredits: number,
  rank: Rank,
  multipliers: Readonly<Record<Rank, number>> = DEFAULT_RANK_MULTIPLIERS,
): number {
  return Math.round(baseCredits * multipliers[rank]);
}

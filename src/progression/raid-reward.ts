// レイドの報酬（6-6。Three.js・DOM 非依存）: 基礎額（協力 3000 / ソロ 2000）× 時間ボーナス（7 分未満 ×1.5・9 分未満 ×1.2）
// × 高難度 ×1.8。失敗は 300。協力は全員が同じ額（貢献度で差をつけない）
import { RAID_RULES, type RaidDifficulty } from '../data/raid';

export interface RaidRewardInput {
  readonly coop: boolean;
  readonly cleared: boolean;
  /** クリア時間（秒。カウントダウンの後から） */
  readonly seconds: number;
  readonly difficulty: RaidDifficulty;
}

/** 時間ボーナスの倍率 */
export function raidTimeBonus(seconds: number): number {
  for (const b of RAID_RULES.reward.timeBonus) if (seconds < b.underSeconds) return b.scale;
  return 1;
}

/** 報酬のクレジット（整数） */
export function raidReward(r: Readonly<RaidRewardInput>): number {
  const c = RAID_RULES.reward;
  if (!r.cleared) return c.failCredits;
  const base = r.coop ? c.coopBase : c.soloBase;
  const hard = r.difficulty === 'hard' ? RAID_RULES.hard.rewardScale : 1;
  return Math.round(base * raidTimeBonus(r.seconds) * hard);
}

// リングレース（7-1）のタイム・ランク・報酬の計算（Three.js 非依存）。数値は src/data/race.ts
import { RACE_CONFIG } from '../../data/race';
import { RANKS, type Rank } from '../../data/ranking';

/**
 * タイム = 走行の時計 + 未通過のリング × 5 秒 − 細いリングの通過 × 2 秒（0 未満にはしない）。
 * 表示・記録は 1/1000 秒に丸める
 */
export function raceTime(rawSeconds: number, missed: number, thinPassed: number): number {
  const c = RACE_CONFIG;
  const t = rawSeconds + missed * c.missPenaltySeconds - thinPassed * c.thinBonusSeconds;
  return Math.max(0, Math.round(t * 1000) / 1000);
}

/** ランク: ゴールドタイム以下で S、×1.15 以下 A、×1.3 以下 B、それより遅くても完走なら C */
export function raceRank(time: number, goldTime: number): Rank {
  const r = RACE_CONFIG.rankRatios;
  if (time <= goldTime) return 'S';
  if (time <= goldTime * r.A) return 'A';
  if (time <= goldTime * r.B) return 'B';
  return 'C';
}

export function betterRank(a: Rank, b: Rank | null): boolean {
  return b === null || RANKS.indexOf(a) < RANKS.indexOf(b);
}

/**
 * 完走の報酬（CR）。初クリアはそのランクの額、ランクを更新したら前のランクの額との差額、それ以外は 300。
 * previousBest はこの走行の前の最高ランク（未クリアは null）
 */
export function raceReward(rank: Rank, previousBest: Rank | null): number {
  const c = RACE_CONFIG;
  if (previousBest === null) return c.rankRewards[rank];
  if (betterRank(rank, previousBest)) return c.rankRewards[rank] - c.rankRewards[previousBest];
  return c.repeatReward;
}

/** 秒 → 「1:02.345」（1 分未満は「42.345」） */
export function formatRaceTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  const sec = s.toFixed(3).padStart(m > 0 ? 6 : 1, '0');
  return m > 0 ? `${m}:${sec}` : sec;
}

/** 差の表示「+1.23」「−0.45」（0.01 秒単位。0 は ±0.00） */
export function formatDelta(seconds: number): string {
  const v = Math.round(seconds * 100) / 100;
  if (v === 0) return '±0.00';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
}

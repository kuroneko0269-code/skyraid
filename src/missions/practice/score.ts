// 練習場（9-5）の結果: スコア・命中率・撃墜までの平均時間と、狙いの指標から選ぶ一言の助言（Three.js・DOM 非依存）
import { PRACTICE_CONFIG, type PracticeDrill } from '../../data/practice';
import type { AimStatsTotals } from './aim-stats';

/** 助言の種類（表の practice.advice.<key>） */
export const PRACTICE_ADVICE = [
  'noShots',
  'offAim',
  'offScreen',
  'overshoot',
  'noKills',
  'steady',
] as const;
export type PracticeAdvice = (typeof PRACTICE_ADVICE)[number];

export interface PracticeResult {
  readonly drill: PracticeDrill;
  readonly seconds: number;
  readonly score: number;
  readonly kills: number;
  /** 機銃の発射数・命中数・命中率（0〜1。撃っていなければ null） */
  readonly shots: number;
  readonly hits: number;
  readonly accuracy: number | null;
  /** 撃墜までの平均（秒。始め・前の撃墜・模擬の敵の出現から。撃墜なしは null） */
  readonly avgKillSeconds: number | null;
  /** 照準の外で撃った割合（0〜1。撃っていなければ null） */
  readonly offAim: number | null;
  /** 敵が画面の外にいた割合（0〜1。対象がいなければ null） */
  readonly offScreen: number | null;
  /** 敵が画面の外にいた秒数 */
  readonly offScreenSeconds: number;
  /** 行き過ぎて戻した回数と 1 分あたり */
  readonly overshoots: number;
  readonly overshootPerMinute: number;
  /** 9-5b: 射程外で撃った割合（0〜1。撃っていなければ null）と、追い越した回数 */
  readonly offRange: number | null;
  readonly overtakes: number;
  readonly advice: PracticeAdvice;
}

/** スコア = 撃墜 × (perKill + 命中率（%）)。四捨五入 */
export function practiceScore(kills: number, accuracy: number | null): number {
  return Math.round(kills * (PRACTICE_CONFIG.score.perKill + (accuracy ?? 0) * 100));
}

/** 一言の助言（data/practice.ts の閾値。上から順に最初に当てはまったもの） */
export function practiceAdvice(r: Omit<PracticeResult, 'advice'>): PracticeAdvice {
  const a = PRACTICE_CONFIG.advice;
  if (r.shots === 0) return 'noShots';
  if (r.shots >= a.minShotsForAccuracy && r.offAim !== null && r.offAim > a.offAim) return 'offAim';
  if (r.offScreen !== null && r.offScreen > a.offScreen) return 'offScreen';
  if (r.overshootPerMinute > a.overshootPerMinute) return 'overshoot';
  if (r.kills === 0) return 'noKills';
  return 'steady';
}

/** 数えた値から結果を組み立てる */
export function buildPracticeResult(
  drill: PracticeDrill,
  seconds: number,
  counts: { kills: number; shots: number; hits: number; killTimes: readonly number[] },
  aim: Readonly<AimStatsTotals>,
): PracticeResult {
  const accuracy = counts.shots > 0 ? counts.hits / counts.shots : null;
  const times = counts.killTimes;
  const minutes = aim.aliveSteps / 60 / 60;
  const base = {
    drill,
    seconds,
    score: practiceScore(counts.kills, accuracy),
    kills: counts.kills,
    shots: counts.shots,
    hits: counts.hits,
    accuracy,
    avgKillSeconds: times.length > 0 ? times.reduce((s, v) => s + v, 0) / times.length : null,
    offAim: aim.fireSteps > 0 ? 1 - aim.fireInCone / aim.fireSteps : null,
    offScreen: aim.engagedSteps > 0 ? aim.offScreenSteps / aim.engagedSteps : null,
    offScreenSeconds: aim.offScreenSteps / 60,
    overshoots: aim.overshoots,
    overshootPerMinute: minutes > 0 ? aim.overshoots / minutes : 0,
    offRange: aim.fireSteps > 0 ? aim.fireOutOfRange / aim.fireSteps : null,
    overtakes: aim.overtakes,
  };
  return { ...base, advice: practiceAdvice(base) };
}

// 練習場の助言（9-5c）と飛行中の一言の数値。助言の選び方は src/missions/practice/advice.ts、一言は tips.ts、文は表の
// practice.issues / practice.good / practice.tips。閾値は 9-5b の効果の表（docs/control-analysis.md）の
// 実機（v1.0.5）・模擬の人の変更前（速度合わせなし）・変更後（ON）の間に置いた（決定は docs/decisions.md の 9-5c）
import type { PracticeDrill } from './practice';

/** 問題の種類（優先度の高い順。結果の画面には当てはまったものを上から最大 maxIssues 個） */
export const PRACTICE_ISSUES = [
  'noShots',
  'overtake',
  'offRange',
  'lost',
  'offAim',
  'overshoot',
  'noKills',
  'slowKill',
] as const;
export type PracticeIssue = (typeof PRACTICE_ISSUES)[number];

/** 良かった点の種類（上から最初に当てはまった 1 つ。問題に出した指標のものは選ばない） */
export const PRACTICE_GOODS = [
  'accuracy',
  'fastKills',
  'noOvertake',
  'inRange',
  'onScreen',
  'kills',
  'tried',
] as const;
export type PracticeGood = (typeof PRACTICE_GOODS)[number];

export const PRACTICE_ADVICE_CONFIG = {
  maxIssues: 3,
  /** 追い越し: 1 分あたり（実機 4.5・変更前 4.8・変更後 3.5）と最低の回数 */
  overtakePerMinute: 4,
  overtakeMin: 2,
  /** 射程外で撃った割合（実機 59.8%・ボット 4〜7%） */
  offRange: 0.25,
  /** 的が画面の外（後ろを含む）にいた割合（実機 59.9%・変更前 48.0%・変更後 40.2%。9-5 の一言と同じ） */
  offScreen: 0.45,
  /** 照準の外で撃った割合（9-5 の一言と同じ。少ない発射では見ない） */
  offAim: 0.6,
  minShotsForAccuracy: 30,
  /** 行き過ぎて戻した回数（1 分あたり。9-5 の一言と同じ） */
  overshootPerMinute: 40,
  /** 撃墜までの平均がこれより長い（秒。動く的: 変更前 23.5・変更後 13.3） */
  slowKillSeconds: { static: 20, moving: 20, bandit: 30 } satisfies Record<PracticeDrill, number>,
  /** 良かった点: 命中率・撃墜までの速さ（slowKillSeconds × この比より短い）・射程の内・画面の内 */
  goodAccuracy: 0.15,
  fastKillRatio: 0.6,
  goodOffRange: 0.05,
  goodOffScreen: 0.25,
} as const;

/** 飛行中の一言（tips.ts） */
export const PRACTICE_TIPS_CONFIG = {
  /** 射程外で撃ち続けた秒数（途切れて quiet 秒たつと数え直す） */
  offRangeSeconds: 1.2,
  offRangeQuietSeconds: 2,
  /** 選んだ的が画面の外にい続けた秒数 */
  lostSeconds: 4,
  /** 同じ一言を繰り返すまで・どれかの一言の後の間（秒） */
  sameTipSeconds: 10,
  anyTipSeconds: 4,
  /** 画面に出す秒数 */
  showSeconds: 3,
} as const;

// 練習場の助言（9-5c。Three.js・DOM 非依存）: 結果の指標から、その回の問題を優先度順に最大 3 つと、良かった点を 1 つ選ぶ。
// 文（具体的な直し方）は表示の側が設定（タッチか・速度合わせ・自動射撃）に合わせて選ぶ（src/ui/practice-advice-text.ts）
import {
  PRACTICE_ADVICE_CONFIG as A,
  PRACTICE_GOODS,
  PRACTICE_ISSUES,
  type PracticeGood,
  type PracticeIssue,
} from '../../data/practice-advice';
import type { PracticeDrill } from '../../data/practice';

/** 助言に使う指標（PracticeResult の一部） */
export interface AdviceMetrics {
  readonly drill: PracticeDrill;
  readonly seconds: number;
  readonly kills: number;
  readonly shots: number;
  readonly accuracy: number | null;
  readonly avgKillSeconds: number | null;
  readonly offAim: number | null;
  readonly offScreen: number | null;
  readonly offScreenSeconds: number;
  readonly overshootPerMinute: number;
  readonly offRange: number | null;
  readonly overtakes: number;
}

export interface PracticeAdviceSet {
  /** 問題（優先度の高い順・最大 maxIssues 個） */
  readonly issues: readonly PracticeIssue[];
  readonly good: PracticeGood;
}

/** 当てはまる問題（優先度の順。数を絞る前） */
export function practiceIssues(m: Readonly<AdviceMetrics>): PracticeIssue[] {
  const minutes = m.seconds / 60;
  const hit: Record<PracticeIssue, boolean> = {
    noShots: m.shots === 0,
    overtake:
      m.overtakes >= A.overtakeMin && minutes > 0 && m.overtakes / minutes >= A.overtakePerMinute,
    offRange: m.shots > 0 && m.offRange !== null && m.offRange >= A.offRange,
    lost: m.offScreen !== null && m.offScreen > A.offScreen,
    offAim: m.shots >= A.minShotsForAccuracy && m.offAim !== null && m.offAim > A.offAim,
    overshoot: m.overshootPerMinute > A.overshootPerMinute,
    noKills: m.kills === 0 && m.shots > 0,
    slowKill:
      m.kills > 0 && m.avgKillSeconds !== null && m.avgKillSeconds > A.slowKillSeconds[m.drill],
  };
  return PRACTICE_ISSUES.filter((k) => hit[k]);
}

/** 良かった点（問題に出した指標のものは選ばない。どれも当てはまらなければ tried） */
export function practiceGood(
  m: Readonly<AdviceMetrics>,
  issues: readonly PracticeIssue[],
): PracticeGood {
  const has = (k: PracticeIssue): boolean => issues.includes(k);
  const ok: Record<PracticeGood, boolean> = {
    accuracy:
      m.shots >= A.minShotsForAccuracy &&
      m.accuracy !== null &&
      m.accuracy >= A.goodAccuracy &&
      !has('offAim'),
    fastKills:
      m.kills >= 2 &&
      m.avgKillSeconds !== null &&
      m.avgKillSeconds <= A.slowKillSeconds[m.drill] * A.fastKillRatio,
    noOvertake: m.kills > 0 && m.overtakes === 0,
    inRange: m.shots > 0 && m.offRange !== null && m.offRange <= A.goodOffRange && !has('offRange'),
    onScreen: m.offScreen !== null && m.offScreen <= A.goodOffScreen,
    kills: m.kills > 0,
    tried: true,
  };
  return PRACTICE_GOODS.find((k) => ok[k]) ?? 'tried';
}

export function practiceAdviceSet(m: Readonly<AdviceMetrics>): PracticeAdviceSet {
  const all = practiceIssues(m);
  return { issues: all.slice(0, A.maxIssues), good: practiceGood(m, all) };
}

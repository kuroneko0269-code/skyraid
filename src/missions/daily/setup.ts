// 日替わりチャレンジ（9-9）の条件 → 今ある仕組みの組み立て（Three.js・DOM 非依存）。的あて・動く的・敵機の連戦は練習場の課題
// （PracticeRunner）の長さと出し方を差し替え、リングレースは海岸周回のリングを周回の数だけ並べたコースにする。
// スコアの数え方: 的の課題は練習場と同じ「撃墜 ×（100 + 命中率%）」（大きいほど良い）、レースはタイム（ミリ秒。小さいほど良い）
import { findCourse } from '../../data/courses';
import { DAILY_CONFIG, dailyHigherIsBetter, type DailyKind } from '../../data/daily';
import { t } from '../../core/i18n';
import type { PracticeDrill } from '../../data/practice';
import type { PracticeOptions } from '../practice/runner';
import type { CourseDef } from '../race/types';
import type { DailySpec } from './schedule';

const DRILLS: Readonly<Record<Exclude<DailyKind, 'race'>, PracticeDrill>> = {
  targets: 'static',
  drones: 'moving',
  gauntlet: 'bandit',
};

/** 練習場の課題で遊ぶ種類なら、その課題と差し替え（レースは null） */
export function dailyPractice(
  spec: Pick<DailySpec, 'kind' | 'tier'>,
): { drill: PracticeDrill; options: PracticeOptions } | null {
  const c = DAILY_CONFIG;
  switch (spec.kind) {
    case 'targets':
      return {
        drill: DRILLS.targets,
        options: { duration: c.durations.targets, targetCount: c.targetCount[spec.tier] },
      };
    case 'drones':
      return {
        drill: DRILLS.drones,
        options: { duration: c.durations.drones, droneSpeedScale: c.droneSpeed[spec.tier] },
      };
    case 'gauntlet':
      return {
        drill: DRILLS.gauntlet,
        options: {
          duration: c.durations.gauntlet,
          banditDifficulty: c.gauntletDifficulty[spec.tier],
        },
      };
    case 'race':
      return null;
  }
}

/** 周回の数（レースだけ。ほかは 0） */
export function dailyLaps(spec: Pick<DailySpec, 'kind' | 'tier'>): number {
  return spec.kind === 'race' ? DAILY_CONFIG.race.laps[spec.tier] : 0;
}

/**
 * レースの種類のコース: 海岸周回のリングを周回の数だけ並べる（最後のリングから最初のリングまでは約 1.7km のまっすぐ）。
 * 制限時間・ゴールドタイムは 1 周の値 × 周回の数。天候は日替わりの条件
 */
export function dailyCourse(
  spec: Pick<DailySpec, 'kind' | 'tier' | 'weatherId'>,
): CourseDef | null {
  if (spec.kind !== 'race') return null;
  const base = findCourse(DAILY_CONFIG.race.courseId);
  if (!base) return null;
  const laps = dailyLaps(spec);
  const rings = Array.from({ length: laps }, () => base.rings).flat();
  return {
    id: `daily-${base.id}-${String(laps)}`,
    get name() {
      return t('daily.raceName', { course: base.name, laps });
    },
    get note() {
      return base.note;
    },
    get level() {
      return base.level;
    },
    mapId: base.mapId,
    weatherId: spec.weatherId,
    start: base.start,
    rings,
    timeLimitSeconds: base.timeLimitSeconds * laps,
    goldTimeSeconds: base.goldTimeSeconds * laps,
  };
}

/** 1 回の長さの目安（秒。的の課題は課題の長さ、レースはゴールドタイム） */
export function dailyMinutesHint(spec: Pick<DailySpec, 'kind' | 'tier'>): number {
  const p = dailyPractice(spec);
  if (p) return (p.options.duration ?? 0) / 60;
  const base = findCourse(DAILY_CONFIG.race.courseId);
  return ((base?.goldTimeSeconds ?? 0) * dailyLaps(spec) * 1.25) / 60;
}

/** a が b より良いか（同じなら false） */
export function dailyBetter(kind: DailyKind, a: number, b: number): boolean {
  return dailyHigherIsBetter(kind) ? a > b : a < b;
}

/** 練習場の結果 → スコア（的の課題） */
export function dailyPracticeValue(score: number): number {
  return Math.max(0, Math.min(DAILY_CONFIG.scoreMax, Math.round(score)));
}

/** レースの結果 → タイム（ミリ秒。完走だけ。時間切れは null） */
export function dailyRaceValue(r: { outcome: string; time: number }): number | null {
  if (r.outcome !== 'finished' || !Number.isFinite(r.time) || r.time <= 0) return null;
  return Math.round(r.time * 1000);
}

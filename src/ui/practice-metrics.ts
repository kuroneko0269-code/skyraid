// 練習場の結果（9-10d）の指標 8 つと、助言・良かった点がどの指標の話か。DOM・CSS 非依存（tests/practice-metrics.test.ts）。
// 指標の札は「名前・大きな数・下の補足」、助言の札の右端は「数・短い名前」。文は表の practice.metric.*
import { formatDecimal } from '../core/format';
import { t } from '../core/i18n';
import type { PracticeGood, PracticeIssue } from '../data/practice-advice';
import type { PracticeResult } from '../missions/practice/score';

/** 指標の並び（指標のタブの 4 × 2 の札。上の段から左 → 右） */
export const PRACTICE_METRICS = [
  'kills',
  'accuracy',
  'avgKill',
  'overtakes',
  'offRange',
  'offAim',
  'offScreen',
  'overshoot',
] as const;
export type PracticeMetric = (typeof PRACTICE_METRICS)[number];

/** 助言 → その助言が出た理由の指標 */
export const ISSUE_METRIC: Readonly<Record<PracticeIssue, PracticeMetric>> = {
  noShots: 'accuracy',
  overtake: 'overtakes',
  offRange: 'offRange',
  lost: 'offScreen',
  offAim: 'offAim',
  overshoot: 'overshoot',
  noKills: 'kills',
  slowKill: 'avgKill',
};

/** 良かった点 → 指標（最後まで追いかけた「tried」は数が無い） */
export const GOOD_METRIC: Readonly<Record<PracticeGood, PracticeMetric | null>> = {
  accuracy: 'accuracy',
  fastKills: 'avgKill',
  noOvertake: 'overtakes',
  inRange: 'offRange',
  onScreen: 'offScreen',
  kills: 'kills',
  tried: null,
};

export interface MetricView {
  readonly id: PracticeMetric;
  /** 札の名前・助言の札の右端の短い名前 */
  readonly label: string;
  readonly short: string;
  /** 大きく出す数（無ければ —） */
  readonly value: string;
  /** 下の補足（例: 20 / 111 発） */
  readonly sub: string;
  /** 数え方の説明（title） */
  readonly hint: string;
}

const pct = (v: number | null): string => (v === null ? '—' : `${formatDecimal(v * 100, 1)}%`);
const sec = (v: number | null): string =>
  v === null ? '—' : t('practice.seconds', { seconds: formatDecimal(v, 1) });
const count = (n: number): string => t('practice.metric.count', { count: String(n) });

/** 1 つの指標の表示 */
export function metricView(id: PracticeMetric, r: Readonly<PracticeResult>): MetricView {
  const k = `practice.metric.${id}`;
  const base = { id, label: t(`${k}.label`), short: t(`${k}.short`) };
  const hint = (key: string): string => t(`practice.result.${key}Hint`);
  switch (id) {
    case 'kills':
      return {
        ...base,
        value: String(r.kills),
        sub: t(`${k}.sub`, { seconds: String(Math.round(r.seconds)) }),
        hint: '',
      };
    case 'accuracy':
      return {
        ...base,
        value: pct(r.accuracy),
        sub:
          r.accuracy === null
            ? t('practice.result.noShots')
            : t(`${k}.sub`, { hits: String(r.hits), shots: String(r.shots) }),
        hint: '',
      };
    case 'avgKill':
      return {
        ...base,
        value: sec(r.avgKillSeconds),
        sub: r.avgKillSeconds === null ? t(`${k}.none`) : t(`${k}.sub`, { kills: String(r.kills) }),
        hint: '',
      };
    case 'overtakes':
      return { ...base, value: count(r.overtakes), sub: t(`${k}.sub`), hint: hint('overtakes') };
    case 'offRange':
      return { ...base, value: pct(r.offRange), sub: t(`${k}.sub`), hint: hint('offRange') };
    case 'offAim':
      return { ...base, value: pct(r.offAim), sub: t(`${k}.sub`), hint: hint('offAim') };
    case 'offScreen':
      return {
        ...base,
        value: r.offScreen === null ? '—' : sec(r.offScreenSeconds),
        sub: r.offScreen === null ? t(`${k}.none`) : t(`${k}.sub`, { ratio: pct(r.offScreen) }),
        hint: hint('offScreen'),
      };
    case 'overshoot':
      return {
        ...base,
        value: count(r.overshoots),
        sub: t(`${k}.sub`, { perMinute: String(Math.round(r.overshootPerMinute)) }),
        hint: hint('overshoot'),
      };
  }
}

/** 助言に出た指標（指標のタブでオレンジの枠にする） */
export function flaggedMetrics(issues: readonly PracticeIssue[]): ReadonlySet<PracticeMetric> {
  return new Set(issues.map((k) => ISSUE_METRIC[k]));
}

// 練習場の助言（9-5c）の文: 問題（最大 3 つ）と良かった点を、その回の設定（タッチか・速度合わせ・自動射撃）に合わせた直し方の文にする。
// 飛行中の一言の文も。DOM・CSS 非依存（解析のツール scripts/replay-analysis/advice.ts からも読む）
import { t } from '../core/i18n';
import type { PracticeGood, PracticeIssue } from '../data/practice-advice';
import type { FlightTip } from '../missions/practice/tips';
import type { PracticeResult } from '../missions/practice/score';
import { parsePracticeSettings } from '../progression/practice-records';
import { formatDecimal } from '../core/format';

// practice-text.ts と同じ書式（あちらは設定の部品と CSS を読むので、解析のツールから読めるようここに置く）
const formatRatio = (v: number | null): string =>
  v === null ? '—' : `${formatDecimal(v * 100, 1)}%`;
const formatSeconds = (v: number | null): string =>
  v === null ? '—' : t('practice.seconds', { seconds: formatDecimal(v, 1) });

/** 文の出し分けに使う設定 */
export interface AdviceContext {
  readonly touch: boolean;
  readonly autoFire: boolean;
  readonly speedMatch: boolean;
}

/** 記録の設定の見出し（practiceSettingsKey）から。読めなければタッチでない扱い */
export function adviceContext(settingsKey: string): AdviceContext {
  const s = parsePracticeSettings(settingsKey)?.touch;
  return { touch: !!s, autoFire: s?.autoFire ?? false, speedMatch: s?.speedMatch ?? false };
}

function issueVariant(k: PracticeIssue, c: AdviceContext): string {
  switch (k) {
    case 'noShots':
    case 'offRange':
      return c.touch && c.autoFire ? 'auto' : 'manual';
    case 'overtake':
      return !c.touch ? 'manual' : c.speedMatch ? 'on' : 'off';
    case 'overshoot':
      return c.touch ? 'touch' : 'all';
    default:
      return 'all';
  }
}

/** 問題の文（具体的な直し方つき） */
export function issueText(k: PracticeIssue, r: Readonly<PracticeResult>, c: AdviceContext): string {
  return t(`practice.issues.${k}.${issueVariant(k, c)}`, {
    count: String(r.overtakes),
    ratio: formatRatio(k === 'offRange' ? r.offRange : k === 'offAim' ? r.offAim : r.offScreen),
    seconds: formatSeconds(k === 'slowKill' ? r.avgKillSeconds : r.offScreenSeconds),
    perMinute: String(Math.round(r.overshootPerMinute)),
  });
}

/** 良かった点の文 */
export function goodText(k: PracticeGood, r: Readonly<PracticeResult>): string {
  return t(`practice.good.${k}`, {
    ratio: formatRatio(k === 'accuracy' ? r.accuracy : k === 'inRange' ? r.offRange : r.offScreen),
    seconds: formatSeconds(r.avgKillSeconds),
    kills: String(r.kills),
  });
}

/** 飛行中の一言の文 */
export function tipText(tip: FlightTip, c: Pick<AdviceContext, 'touch' | 'speedMatch'>): string {
  const v = tip === 'overtake' ? (c.touch && c.speedMatch ? 'on' : 'off') : 'all';
  return t(`practice.tips.${tip}.${v}`);
}

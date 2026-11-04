// 9-5c 練習場の助言の当たり方（`--advice`）: 9-5b の効果の表の場面（実機の記録・模擬の人の変更前 = 速度合わせなし・変更後 = ON）で、
// 結果の画面に出る問題（優先度順に最大 3 つ）と良かった点を数える。実機は v1.0.5 の記録で、表の値（docs/control-analysis.md の 9-5b）から
// 指標を組み立てる（記録はリポジトリに無い。照準の外・行き過ぎは表に無いので「無し」）。文は日本語の例を 1 つずつ出す
import { PRACTICE_ISSUES, type PracticeIssue } from '../../src/data/practice-advice';
import { isPracticeDrill, type PracticeDrill } from '../../src/data/practice';
import { practiceAdviceSet, type AdviceMetrics } from '../../src/missions/practice/advice';
import type { PracticeResult } from '../../src/missions/practice/score';
import type { GamePlay } from '../../src/missions/game-play';
import { goodText, issueText, type AdviceContext } from '../../src/ui/practice-advice-text';
import { DEVICE_FIX_ROWS } from './device-fix';
import { findRole, flyMission } from './flight';
import { TimedAnalyzer } from './kill-timer';

/** 実機（v1.0.5・動く的・80 秒）: 9-5b の表の値 */
const REAL: AdviceMetrics = {
  drill: 'moving',
  seconds: 80,
  kills: 0,
  shots: 109,
  accuracy: 1 / 109,
  avgKillSeconds: null,
  offAim: null,
  offScreen: 0.599,
  offScreenSeconds: 0.599 * 80,
  overshootPerMinute: 0,
  offRange: 0.598,
  overtakes: 6,
};

function asResult(m: AdviceMetrics): PracticeResult {
  return {
    ...m,
    score: 0,
    hits: Math.round((m.accuracy ?? 0) * m.shots),
    overshoots: 0,
    advice: 'noShots',
    ...practiceAdviceSet(m),
  };
}

function describe(r: PracticeResult, ctx: AdviceContext): string {
  const lines = r.issues.map((k, i) => `  ${i + 1}. ${issueText(k, r, ctx)}`);
  lines.push(`  ＋ ${goodText(r.good, r)}`);
  return lines.join('\n');
}

const TOUCH_ON: AdviceContext = { touch: true, autoFire: true, speedMatch: true };
const TOUCH_OFF: AdviceContext = { touch: true, autoFire: true, speedMatch: false };

/** 場面ごとの表（問題が出た回の数・1 つ目の問題・良かった点）と文の例 */
export function runAdvice(
  seeds: number,
  progress: (line: string) => void,
  drills: readonly string[] = ['moving'],
): string {
  const out: string[] = [];
  const header = ['場面', '回数', ...PRACTICE_ISSUES, '1 つ目の問題', '良かった点'];
  out.push(header.join(' | '), header.map(() => '---').join(' | '));
  const real = asResult(REAL);
  out.push(
    [
      '実機（v1.0.5・動く的）',
      '1',
      ...PRACTICE_ISSUES.map((k) => (real.issues.includes(k) ? '1' : '0')),
      real.issues[0] ?? '-',
      real.good,
    ].join(' | '),
  );
  const examples: string[] = ['実機（v1.0.5・動く的）', describe(real, TOUCH_OFF)];
  const role = findRole('human');
  for (const d of drills) {
    if (!isPracticeDrill(d)) continue;
    const drill: PracticeDrill = d;
    for (const row of DEVICE_FIX_ROWS) {
      const count = new Map<PracticeIssue, number>();
      const first = new Map<string, number>();
      const good = new Map<string, number>();
      let example: PracticeResult | null = null;
      for (let seed = 1; seed <= seeds; seed++) {
        const box: { play: GamePlay | null } = { play: null };
        flyMission(`practice:${drill}`, seed, role, {
          tweaks: row.tweaks,
          analyzer: (play) => {
            box.play = play;
            return new TimedAnalyzer(play, { aspect: 2.16, assist: row.tweaks.assist });
          },
        });
        const r = box.play?.practice?.result;
        if (!r) continue;
        example ??= r;
        for (const k of r.issues) count.set(k, (count.get(k) ?? 0) + 1);
        const f = r.issues[0] ?? '-';
        first.set(f, (first.get(f) ?? 0) + 1);
        good.set(r.good, (good.get(r.good) ?? 0) + 1);
      }
      const top = (m: Map<string, number>): string =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k} ${n}`)
          .join('・');
      const label = `${drill}: ${row.id === 'before' ? '変更前（速度合わせなし）' : '変更後（速度合わせ ON）'}`;
      out.push(
        [
          label,
          String(seeds),
          ...PRACTICE_ISSUES.map((k) => String(count.get(k) ?? 0)),
          top(first),
          top(good),
        ].join(' | '),
      );
      progress(out[out.length - 1] ?? '');
      if (example)
        examples.push(
          `${label}（シード 1）`,
          describe(example, row.id === 'before' ? TOUCH_OFF : TOUCH_ON),
        );
    }
  }
  return [...out, '', ...examples].join('\n');
}

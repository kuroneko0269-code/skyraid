// 練習場の助言（9-5c）: 問題を優先度順に最大 3 つ・良かった点 1 つ・設定に合わせた直し方の文・飛行中の一言
import { beforeAll, describe, expect, it } from 'vitest';
import {
  practiceAdviceSet,
  practiceIssues,
  type AdviceMetrics,
} from '../src/missions/practice/advice';
import { FlightTips } from '../src/missions/practice/tips';
import type { PracticeResult } from '../src/missions/practice/score';
import { adviceContext, issueText, goodText, tipText } from '../src/ui/practice-advice-text';
import { useLocale } from './i18n-helpers';
import { newPlay } from './mission-bots';
import { runPractice } from './practice-bot';
import { HUMAN_SKILL } from '../scripts/replay-analysis/flight';

/** 9-5b の実機（v1.0.5・動く的・80 秒）の値 */
const REAL: AdviceMetrics = {
  drill: 'moving',
  seconds: 80,
  kills: 0,
  shots: 109,
  accuracy: 1 / 109,
  avgKillSeconds: null,
  offAim: null,
  offScreen: 0.599,
  offScreenSeconds: 47.9,
  overshootPerMinute: 0,
  offRange: 0.598,
  overtakes: 6,
};

/** 模擬の人・速度合わせ ON（9-5b の変更後に近い値） */
const GOOD: AdviceMetrics = {
  drill: 'moving',
  seconds: 75,
  kills: 6,
  shots: 300,
  accuracy: 0.21,
  avgKillSeconds: 11,
  offAim: 0.4,
  offScreen: 0.4,
  offScreenSeconds: 30,
  overshootPerMinute: 10,
  offRange: 0.07,
  overtakes: 4,
};

const full = (m: AdviceMetrics): PracticeResult => ({
  ...m,
  score: 0,
  hits: 0,
  overshoots: 0,
  advice: 'steady',
  ...practiceAdviceSet(m),
});

describe('問題と良かった点の選び方', () => {
  it('実機の記録: 追い越し → 射程外 → 見失いの 3 つ（優先度順）。撃墜なしは 4 つ目なので出さない。良かった点は「最後まで追いかけた」', () => {
    expect(practiceIssues(REAL)).toEqual(['overtake', 'offRange', 'lost', 'noKills']);
    const set = practiceAdviceSet(REAL);
    expect(set.issues).toEqual(['overtake', 'offRange', 'lost']);
    expect(set.good).toBe('tried');
  });

  it('変更後に近い値: 問題なし、良かった点は命中率', () => {
    expect(practiceAdviceSet(GOOD)).toEqual({ issues: [], good: 'accuracy' });
  });

  it('撃っていない回は「撃っていない」が先頭。良かった点は問題の指標から選ばない', () => {
    const m = { ...GOOD, shots: 0, accuracy: null, offAim: null, offRange: null, kills: 0 };
    expect(practiceAdviceSet(m).issues[0]).toBe('noShots');
    const slow = { ...GOOD, avgKillSeconds: 40, offRange: 0.3 };
    const set = practiceAdviceSet(slow);
    expect(set.issues).toEqual(['offRange', 'slowKill']);
    expect(set.good).toBe('accuracy');
  });
});

describe('文（設定に合わせた直し方）', () => {
  beforeAll(() => {
    useLocale('ja');
  });

  it('追い越し: 速度合わせ OFF なら「ON に」、ON なら「機首を向けたまま」、キーボード・パッドは「スロットルを半分より下げ」', () => {
    const r = full(REAL);
    expect(issueText('overtake', r, adviceContext('touch:direct:normal:1:1.5'))).toContain(
      '速度合わせ」を ON',
    );
    expect(issueText('overtake', r, adviceContext('touch:direct:normal:1:1.5:s'))).toContain(
      '機首を的へ向けたまま',
    );
    expect(issueText('overtake', r, adviceContext('keyboard'))).toContain('半分より下げ');
    expect(issueText('overtake', r, adviceContext('keyboard'))).toContain('6 回');
  });

  it('射程外は割合を入れ、自動射撃 ON なら任せる案内。良かった点・一言も出る', () => {
    const r = full(REAL);
    expect(issueText('offRange', r, adviceContext('touch:direct:normal:1:1.5:s'))).toContain(
      '59.8%',
    );
    expect(issueText('offRange', r, adviceContext('touch:direct:normal:1:1.5'))).toContain(
      '自動射撃',
    );
    expect(issueText('offRange', r, adviceContext('touch:direct:normal:0:1.5'))).not.toContain(
      '自動射撃',
    );
    expect(goodText('accuracy', full(GOOD))).toContain('21.0%');
    expect(tipText('overtake', { touch: true, speedMatch: true })).toContain('機首');
    // 9-5d: 見失いは的の向きと角度（向きが無ければ出さない）
    expect(
      tipText(
        'lost',
        { touch: false, speedMatch: false },
        { side: 'left', angleDeg: 132.4, arrowDeg: -100 },
      ),
    ).toBe('的は左 132° — 左へ曲がり続けて');
    expect(tipText('lost', { touch: false, speedMatch: false })).toBe('');
  });

  it('英語もある', () => {
    useLocale('en');
    expect(issueText('lost', full(REAL), adviceContext('keyboard'))).toContain('edge');
    useLocale('ja');
  });
});

describe('飛行中の一言', () => {
  const counts = (
    o = 0,
    out = 0,
    off = 0,
    eng = 0,
  ): {
    overtakes: number;
    fireOutOfRange: number;
    offScreenSteps: number;
    engagedSteps: number;
  } => ({ overtakes: o, fireOutOfRange: out, offScreenSteps: off, engagedSteps: eng });

  it('追い越した直後・射程外で 1.2 秒撃ち続けた・4 秒見失った。同じ一言は 10 秒、どれかの後は 4 秒あける', () => {
    const tips = new FlightTips();
    expect(tips.update(0, counts())).toBeNull();
    expect(tips.update(0.1, counts(1))).toBe('overtake');
    // 射程外の射撃（ステップ）を 1.2 秒ぶん溜める
    let shown: string | null = null;
    for (let i = 1; i <= 80 && !shown; i++) shown = tips.update(5 + i / 60, counts(1, i));
    expect(shown).toBe('offRange');
    // 見失い: 画面の外の数えだけが増え続ける
    const t0 = 10;
    let lost: string | null = null;
    for (let i = 1; i <= 300 && !lost; i++) lost = tips.update(t0 + i / 60, counts(1, 80, i, i));
    expect(lost).toBe('lost');
    // 直後の追い越しは間を空ける
    expect(tips.update(t0 + 5.1, counts(2, 80, 300, 300))).toBeNull();
  });
});

describe('練習場の結果に問題と良かった点が入る（ボット）', () => {
  it('模擬の人の動く的: 問題は 3 つまで・良かった点が 1 つ', () => {
    const p = runPractice(newPlay(3), 'moving', HUMAN_SKILL, 1);
    const r = p.result;
    expect(r).not.toBeNull();
    expect(r?.issues.length).toBeLessThanOrEqual(3);
    expect(typeof r?.good).toBe('string');
  });
});

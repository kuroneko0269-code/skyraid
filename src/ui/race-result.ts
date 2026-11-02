// リングレース（7-1）のリザルト: タイム（時計・未通過のペナルティ・細いリングのボーナス）、ランク、ベスト更新とゴースト、
// 報酬（獲得 / 残高）、ベスト 5 の中の順位。「もう一度」は飛行へ直接、「コース一覧へ」
import { t } from '../core/i18n';
import './campaign.css';
import './race.css';
import type { RaceResult } from '../missions/race/runner';
import { betterRank, formatRaceTime } from '../missions/race/score';
import type { RaceRecordOutcome } from '../progression/race-records';
import { RecordCardButton } from './card/card-entry';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

export class RaceResultScreen {
  /** ボタンの上の追加の欄（7-B: リプレイを保存） */
  readonly extras: HTMLDivElement;
  /** 8-5: 記録カードのボタン（中身は結果を出す側が set する） */
  readonly card: RecordCardButton;
  readonly root: HTMLDivElement;
  private readonly course: HTMLDivElement;
  private readonly outcome: HTMLHeadingElement;
  private readonly time: HTMLDivElement;
  private readonly badges: HTMLDivElement;
  private readonly rank: HTMLDivElement;
  private readonly facts: HTMLDivElement;
  private readonly retry: HTMLButtonElement;

  constructor(parent: HTMLElement, handlers: { onRetry: () => void; onList: () => void }) {
    const root = createScreen(parent, 'campaign-screen result-screen race-result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'RACE RESULT');
    this.course = el('div', 'result-pilot', panel);
    this.outcome = el('h2', 'ui-title campaign-title result-outcome', panel);
    this.time = el('div', 'race-result-time', panel);
    this.badges = el('div', 'race-result-badges', panel);
    this.rank = el('div', 'result-rank', panel);
    this.facts = el('div', 'campaign-facts', panel);
    this.extras = el('div', 'result-extras', panel);
    this.card = new RecordCardButton(this.extras);
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('race.result.toCourses'),
      handlers.onList,
    );
    this.retry = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('campaign.result.retry'),
      handlers.onRetry,
    );
    this.root = root;
  }

  show(
    r: RaceResult,
    out: RaceRecordOutcome,
    extras: { courseName: string; balance: number; pilotName: string | null; gold: number },
  ): void {
    const done = r.outcome === 'finished';
    this.root.classList.toggle('is-success', done);
    this.course.textContent = `${extras.courseName}${extras.pilotName ? `  /  PILOT ${extras.pilotName}` : ''}`;
    this.outcome.textContent = done ? 'FINISH' : 'TIME OVER';
    this.time.textContent = formatRaceTime(r.time);
    this.badges.replaceChildren();
    if (out.newBest) el('span', '', this.badges, 'NEW RECORD');
    if (out.newBest) el('span', '', this.badges, t('race.result.ghostSaved'));
    else if (out.place !== null)
      el('span', '', this.badges, t('race.result.place', { place: out.place }));
    const prev = out.previousRank;
    if (done && r.rank && prev && betterRank(r.rank, prev)) el('span', '', this.badges, 'RANK UP');
    this.rank.textContent = r.rank ?? '';
    this.rank.hidden = r.rank === null;
    this.rank.classList.toggle('is-rank-s', r.rank === 'S');
    this.facts.replaceChildren();
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact(t('race.result.run'), formatRaceTime(r.rawSeconds));
    fact(
      t('race.result.penalty'),
      r.missed > 0
        ? t('race.result.penaltyValue', { seconds: r.penaltySeconds, missed: r.missed })
        : t('campaign.briefing.none'),
    );
    fact(
      t('race.result.bonus'),
      r.thinPassed > 0
        ? t('race.result.bonusValue', { seconds: r.bonusSeconds, thin: r.thinPassed })
        : t('campaign.briefing.none'),
    );
    fact(t('race.result.gold'), formatRaceTime(extras.gold));
    const best = out.record.times[0];
    if (best)
      fact(
        t('race.result.best'),
        t('race.result.bestValue', {
          time: formatRaceTime(best.time),
          aircraft: best.aircraftName,
        }),
      );
    fact(
      t('campaign.reward'),
      t('campaign.result.rewardValue', {
        earned: formatCredits(out.credits),
        balance: formatCredits(extras.balance),
      }),
    );
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}

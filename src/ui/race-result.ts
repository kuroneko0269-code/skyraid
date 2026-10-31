// リングレース（7-1）のリザルト: タイム（時計・未通過のペナルティ・細いリングのボーナス）、ランク、ベスト更新とゴースト、
// 報酬（獲得 / 残高）、ベスト 5 の中の順位。「もう一度」は飛行へ直接、「コース一覧へ」
import './campaign.css';
import './race.css';
import type { RaceResult } from '../missions/race/runner';
import { betterRank, formatRaceTime } from '../missions/race/score';
import type { RaceRecordOutcome } from '../progression/race-records';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

export class RaceResultScreen {
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
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(buttons, 'ui-button is-ghost campaign-back', 'コース一覧へ', handlers.onList);
    this.retry = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      'もう一度',
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
    if (out.newBest) el('span', '', this.badges, 'ゴーストを保存');
    else if (out.place !== null) el('span', '', this.badges, `ベスト ${out.place} 位`);
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
    fact('走行', formatRaceTime(r.rawSeconds));
    fact('ペナルティ', r.missed > 0 ? `+${r.penaltySeconds} 秒（未通過 ${r.missed}）` : 'なし');
    fact(
      'ボーナス',
      r.thinPassed > 0 ? `−${r.bonusSeconds} 秒（細いリング ${r.thinPassed}）` : 'なし',
    );
    fact('ゴールド', formatRaceTime(extras.gold));
    const best = out.record.times[0];
    if (best) fact('ベスト', `${formatRaceTime(best.time)}（${best.aircraftName}）`);
    fact('報酬', `獲得 +${formatCredits(out.credits)} / 残高 ${formatCredits(extras.balance)}`);
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}

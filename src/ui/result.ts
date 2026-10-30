import './campaign.css';
import type { MissionResult } from '../missions/runner';
import { el } from './hud-dom';
import {
  FAIL_REASON_TEXT,
  formatClock,
  formatCredits,
  objectiveProgressText,
} from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

/** リザルト（2-4）: 成功 / 失敗、目標ごとの達成、時間、被弾、ランク、報酬と「もう一度」「ミッション一覧へ」 */
export class ResultScreen {
  readonly root: HTMLDivElement;
  private readonly outcome: HTMLHeadingElement;
  private readonly reason: HTMLDivElement;
  private readonly objectives: HTMLUListElement;
  private readonly facts: HTMLDivElement;
  private readonly rank: HTMLDivElement;
  private readonly retry: HTMLButtonElement;

  constructor(parent: HTMLElement, handlers: { onRetry: () => void; onList: () => void }) {
    const root = createScreen(parent, 'campaign-screen result-screen');
    const panel = el('div', 'campaign-panel', root);
    el('div', 'campaign-kicker', panel, 'RESULT');
    this.outcome = el('h2', 'campaign-title result-outcome', panel);
    this.reason = el('div', 'result-reason', panel);
    this.rank = el('div', 'result-rank', panel);
    this.objectives = el('ul', 'result-objectives', panel);
    this.facts = el('div', 'campaign-facts', panel);
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(buttons, 'menu-button campaign-back', 'ミッション一覧へ', handlers.onList);
    this.retry = createButton(buttons, 'menu-button campaign-go', 'もう一度', handlers.onRetry);
    this.root = root;
  }

  show(r: MissionResult): void {
    const success = r.outcome === 'success';
    this.root.classList.toggle('is-success', success);
    this.outcome.textContent = success ? 'MISSION COMPLETE' : 'MISSION FAILED';
    this.reason.textContent = r.failReason ? FAIL_REASON_TEXT[r.failReason] : '';
    this.reason.hidden = !r.failReason;
    this.rank.textContent = r.rank ?? '';
    this.rank.hidden = r.rank === null;
    this.objectives.replaceChildren();
    for (const o of r.objectives) {
      const done = o.status === 'complete';
      const li = el('li', done ? 'result-objective is-done' : 'result-objective', this.objectives);
      el('span', 'result-mark', li, done ? '✓' : '✗');
      el('span', '', li, objectiveProgressText(o.def, o.current, o.target));
      if (!o.def.required) el('span', 'tag', li, '任意');
    }
    this.facts.replaceChildren();
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact('時間', formatClock(r.elapsedSeconds));
    fact('被弾', `${Math.round(r.damageTaken)} / ${r.maxHp}`);
    fact('報酬', formatCredits(r.credits));
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}

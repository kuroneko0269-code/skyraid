import './campaign.css';
import './save.css';
import type { MissionResult } from '../missions/runner';
import { el } from './hud-dom';
import {
  FAIL_REASON_TEXT,
  formatClock,
  formatCredits,
  objectiveProgressText,
} from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

/** 3-2: 報酬はセーブに足した後の残高と並べ、パイロット名も出す */
export interface ResultExtras {
  readonly balance: number;
  readonly pilotName: string | null;
  /** 報酬で新しい機体・強化が買える残高になった（3-3） */
  readonly newGear: boolean;
}

/**
 * リザルト（2-4）: 成功 / 失敗、目標ごとの達成、時間、被弾、ランク、報酬（獲得 / 残高。3-2）、パイロット名（3-1）と
 * 「もう一度」「ミッション一覧へ」
 */
export class ResultScreen {
  readonly root: HTMLDivElement;
  private readonly pilot: HTMLDivElement;
  private readonly outcome: HTMLHeadingElement;
  private readonly reason: HTMLDivElement;
  private readonly objectives: HTMLUListElement;
  private readonly facts: HTMLDivElement;
  private readonly rank: HTMLDivElement;
  private readonly gear: HTMLDivElement;
  private readonly retry: HTMLButtonElement;

  constructor(parent: HTMLElement, handlers: { onRetry: () => void; onList: () => void }) {
    const root = createScreen(parent, 'campaign-screen result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'RESULT');
    this.pilot = el('div', 'result-pilot', panel);
    this.outcome = el('h2', 'ui-title campaign-title result-outcome', panel);
    this.reason = el('div', 'result-reason', panel);
    this.rank = el('div', 'result-rank', panel);
    this.objectives = el('ul', 'result-objectives', panel);
    this.facts = el('div', 'campaign-facts', panel);
    this.gear = el('div', 'result-gear', panel, 'ハンガーで新しい装備が買えます');
    this.gear.hidden = true;
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(buttons, 'ui-button is-ghost campaign-back', 'ミッション一覧へ', handlers.onList);
    this.retry = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      'もう一度',
      handlers.onRetry,
    );
    this.root = root;
  }

  show(r: MissionResult, extras: ResultExtras): void {
    const success = r.outcome === 'success';
    this.root.classList.toggle('is-success', success);
    this.outcome.textContent = success ? 'MISSION COMPLETE' : 'MISSION FAILED';
    this.pilot.textContent = extras.pilotName === null ? '' : `PILOT  ${extras.pilotName}`;
    this.pilot.hidden = extras.pilotName === null;
    this.reason.textContent = r.failReason ? FAIL_REASON_TEXT[r.failReason] : '';
    this.reason.hidden = !r.failReason;
    this.rank.textContent = r.rank ?? '';
    this.rank.hidden = r.rank === null;
    this.rank.classList.toggle('is-rank-s', r.rank === 'S');
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
    fact('報酬', `獲得 +${formatCredits(r.credits)} / 残高 ${formatCredits(extras.balance)}`);
    this.gear.hidden = !extras.newGear;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}

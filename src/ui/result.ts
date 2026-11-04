import { t } from '../core/i18n';
import './campaign.css';
import './save.css';
import type { MissionResult } from '../missions/runner';
import { RecordCardButton } from './card/card-entry';
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
  /** チュートリアル（4-11）の文: 見出しと「章の一覧へ」、次の章があれば「次の章へ」（9-5c）。通常のミッションは省略 */
  readonly tutorial?: { readonly title: string; readonly back: string; readonly next: boolean };
  /** 練習場への案内（9-5。チュートリアルの完了・M1 / M2 の失敗）。省略は出さない */
  readonly practiceHint?: 'tutorial' | 'failed';
}

/**
 * リザルト（2-4）: 成功 / 失敗、目標ごとの達成、時間、被弾、ランク、報酬（獲得 / 残高。3-2）、パイロット名（3-1）と
 * 「もう一度」「ミッション一覧へ」
 */
export class ResultScreen {
  /** ボタンの上の追加の欄（7-B: リプレイを保存） */
  readonly extras: HTMLDivElement;
  /** 8-5: 記録カードのボタン（中身は結果を出す側が set する） */
  readonly card: RecordCardButton;
  readonly root: HTMLDivElement;
  private readonly pilot: HTMLDivElement;
  private readonly outcome: HTMLHeadingElement;
  private readonly reason: HTMLDivElement;
  private readonly objectives: HTMLUListElement;
  private readonly facts: HTMLDivElement;
  private readonly rank: HTMLDivElement;
  private readonly gear: HTMLDivElement;
  private readonly practice: HTMLDivElement;
  private readonly practiceText: HTMLSpanElement;
  private readonly retry: HTMLButtonElement;
  private readonly back: HTMLButtonElement;
  private readonly next: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    handlers: {
      onRetry: () => void;
      onList: () => void;
      onPractice: () => void;
      /** 9-5c: チュートリアルの「次の章へ」 */
      onNext: () => void;
    },
  ) {
    const root = createScreen(parent, 'campaign-screen result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'RESULT');
    this.pilot = el('div', 'result-pilot', panel);
    this.outcome = el('h2', 'ui-title campaign-title result-outcome', panel);
    this.reason = el('div', 'result-reason', panel);
    this.rank = el('div', 'result-rank', panel);
    this.objectives = el('ul', 'result-objectives', panel);
    this.facts = el('div', 'campaign-facts', panel);
    this.gear = el('div', 'result-gear', panel, t('campaign.result.newGear'));
    this.gear.hidden = true;
    // 9-5: 練習場への案内（文と「練習場へ」）
    this.practice = el('div', 'result-practice', panel);
    this.practiceText = el('span', 'result-practice-text', this.practice);
    createButton(this.practice, 'ui-button result-practice-go', t('practice.hint.go'), () => {
      handlers.onPractice();
    });
    this.practice.hidden = true;
    this.extras = el('div', 'result-extras', panel);
    this.card = new RecordCardButton(this.extras);
    const buttons = el('div', 'campaign-buttons', panel);
    this.back = createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('campaign.result.toMissions'),
      handlers.onList,
    );
    this.retry = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('campaign.result.retry'),
      handlers.onRetry,
    );
    this.next = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('tutorial.result.next'),
      handlers.onNext,
    );
    this.next.hidden = true;
    this.root = root;
  }

  show(r: MissionResult, extras: ResultExtras): void {
    const success = r.outcome === 'success';
    this.root.classList.toggle('is-success', success);
    this.outcome.textContent =
      extras.tutorial?.title ?? (success ? 'MISSION COMPLETE' : 'MISSION FAILED');
    this.back.textContent = extras.tutorial?.back ?? t('campaign.result.toMissions');
    // 9-5c: 次の章があれば「次の章へ」を主に、「もう一度」は控えめに
    const next = extras.tutorial?.next === true && success;
    this.next.hidden = !next;
    this.retry.classList.toggle('is-primary', !next);
    this.retry.classList.toggle('is-ghost', next);
    this.nextShown = next;
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
      if (!o.def.required) el('span', 'tag', li, t('campaign.optional'));
    }
    this.facts.replaceChildren();
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact(t('campaign.result.time'), formatClock(r.elapsedSeconds));
    fact(t('campaign.result.hitsTaken'), `${Math.round(r.damageTaken)} / ${r.maxHp}`);
    // 6-4: 街のあるマップ（レイド）だけ。スコアの表示で報酬には影響しない
    if (r.protectedBuildings !== undefined)
      fact(t('campaign.result.protectedBuildings'), `${r.protectedBuildings}%`);
    fact(
      t('campaign.reward'),
      t('campaign.result.rewardValue', {
        earned: formatCredits(r.credits),
        balance: formatCredits(extras.balance),
      }),
    );
    this.gear.hidden = !extras.newGear;
    const hint = extras.practiceHint;
    this.practice.hidden = hint === undefined;
    if (hint) this.practiceText.textContent = t(`practice.hint.${hint}`);
  }

  private nextShown = false;

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) (this.nextShown ? this.next : this.retry).focus({ preventScroll: true });
  }
}

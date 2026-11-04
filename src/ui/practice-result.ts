// 練習場（9-5）の結果: スコア・撃墜数・命中率・撃墜までの平均時間と、9-1 の解析と同じ数え方の「照準の外で撃った割合」
// 「敵が画面の外にいた時間」「行き過ぎて戻した回数」、一言の助言、記録（この設定の最高・課題の最高）、設定の欄（その場で変えて
// すぐやり直せる）。「もう一度」は飛行へ直接、「練習場へ」は課題の一覧
import { t } from '../core/i18n';
import './campaign.css';
import './race.css';
import './practice.css';
import { PRACTICE_DRILL_LABELS } from '../data/practice';
import type { PracticeResult } from '../missions/practice/score';
import type { PracticeRecordOutcome } from '../progression/practice-records';
import { el } from './hud-dom';
import { formatRatio, formatSeconds, practiceSettingsLabel } from './practice-text';
import { createButton, createScreen, setScreenShown } from './screen';

/** 記録の扱い（saved: 記録した / changed: 途中で設定を変えたので記録しない / replay: 再生中） */
export type PracticeRecordState =
  { readonly kind: 'saved'; readonly out: PracticeRecordOutcome } | { readonly kind: 'changed' };

export class PracticeResultScreen {
  readonly root: HTMLDivElement;
  /** ボタンの上の追加の欄（7-B: リプレイを保存） */
  readonly extras: HTMLDivElement;
  /** 設定の欄を置く場所 */
  readonly settingsSlot: HTMLDivElement;
  private readonly drill: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly badges: HTMLDivElement;
  private readonly advice: HTMLParagraphElement;
  private readonly facts: HTMLDivElement;
  private readonly retry: HTMLButtonElement;

  constructor(parent: HTMLElement, handlers: { onRetry: () => void; onList: () => void }) {
    const root = createScreen(parent, 'campaign-screen result-screen practice-result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'PRACTICE RESULT');
    this.drill = el('div', 'result-pilot', panel);
    this.score = el('div', 'race-result-time practice-result-score', panel);
    this.badges = el('div', 'race-result-badges', panel);
    this.advice = el('p', 'practice-advice', panel);
    this.facts = el('div', 'campaign-facts', panel);
    this.settingsSlot = el('div', 'practice-settings-slot', panel);
    this.extras = el('div', 'result-extras', panel);
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(buttons, 'ui-button is-ghost campaign-back', t('practice.result.toList'), () => {
      handlers.onList();
    });
    this.retry = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('campaign.result.retry'),
      handlers.onRetry,
    );
    this.root = root;
  }

  show(
    r: Readonly<PracticeResult>,
    record: PracticeRecordState,
    extras: { settings: string; pilotName: string | null },
  ): void {
    this.root.classList.add('is-success');
    const name = PRACTICE_DRILL_LABELS[r.drill].name;
    this.drill.textContent = `${name}${extras.pilotName ? `  /  PILOT ${extras.pilotName}` : ''}`;
    this.score.textContent = t('practice.result.score', { score: String(r.score) });
    this.badges.replaceChildren();
    if (record.kind === 'saved' && record.out.newBest) el('span', '', this.badges, 'NEW RECORD');
    else if (record.kind === 'saved' && record.out.newSettingsBest)
      el('span', '', this.badges, t('practice.result.settingsBest'));
    this.advice.textContent = t(`practice.advice.${r.advice}`);
    this.facts.replaceChildren();
    const fact = (label: string, value: string, hint = ''): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
      if (hint) row.title = hint;
    };
    fact(t('practice.result.kills'), String(r.kills));
    fact(
      t('practice.result.accuracy'),
      r.accuracy === null
        ? t('practice.result.noShots')
        : t('practice.result.accuracyValue', {
            ratio: formatRatio(r.accuracy),
            hits: String(r.hits),
            shots: String(r.shots),
          }),
    );
    fact(t('practice.result.avgKill'), formatSeconds(r.avgKillSeconds));
    fact(t('practice.result.offAim'), formatRatio(r.offAim), t('practice.result.offAimHint'));
    fact(
      t('practice.result.offScreen'),
      r.offScreen === null
        ? '—'
        : t('practice.result.offScreenValue', {
            seconds: formatSeconds(r.offScreenSeconds),
            ratio: formatRatio(r.offScreen),
          }),
      t('practice.result.offScreenHint'),
    );
    fact(
      t('practice.result.overshoot'),
      t('practice.result.overshootValue', {
        count: String(r.overshoots),
        perMinute: String(Math.round(r.overshootPerMinute)),
      }),
      t('practice.result.overshootHint'),
    );
    // 9-5b: 射程外で撃った割合・追い越した回数
    fact(t('practice.result.offRange'), formatRatio(r.offRange), t('practice.result.offRangeHint'));
    fact(
      t('practice.result.overtakes'),
      t('practice.result.overtakesValue', { count: String(r.overtakes) }),
      t('practice.result.overtakesHint'),
    );
    fact(t('practice.select.settings'), practiceSettingsLabel(extras.settings));
    if (record.kind === 'changed') fact(t('practice.result.record'), t('practice.result.changed'));
    else {
      const prev = record.out.previous;
      fact(
        t('practice.result.settingsRecord'),
        prev ? String(Math.max(prev.score, r.score)) : String(r.score),
      );
      const best = record.out.best;
      if (best) fact(t('practice.result.drillBest'), String(best.score));
    }
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}

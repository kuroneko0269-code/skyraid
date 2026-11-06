// 練習場（9-5）の結果: スコア・撃墜数・命中率・撃墜までの平均時間と、9-1 の解析と同じ数え方の「照準の外で撃った割合」
// 「敵が画面の外にいた時間」「行き過ぎて戻した回数」、一言の助言、記録（この設定の最高・課題の最高）、設定の欄（その場で変えて
// すぐやり直せる）。「もう一度」は飛行へ直接、「練習場へ」は課題の一覧。
// 9-9c: スコアの下を「助言・指標・設定」のタブに分けた（それまでは縦に積んでいて、スマホの横画面で縦にスクロールしていた）。
// 「リプレイを保存」と「練習場へ」「もう一度」はタブの外の一番下（いつも見える）
import { t } from '../core/i18n';
import './campaign.css';
import './race.css';
import './practice.css';
import './practice-result.css';
import { PRACTICE_DRILL_LABELS } from '../data/practice';
import type { PracticeResult } from '../missions/practice/score';
import type { PracticeRecordOutcome } from '../progression/practice-records';
import { el } from './hud-dom';
import { PanelTabs } from './panel-tabs';
import { formatRatio, formatSeconds, practiceSettingsLabel } from './practice-text';
import { adviceContext, goodText, issueText } from './practice-advice-text';
import { createButton, createScreen, setScreenShown } from './screen';

/** 記録の扱い（saved: 記録した / changed: 途中で設定を変えたので記録しない / replay: 再生中） */
export type PracticeRecordState =
  { readonly kind: 'saved'; readonly out: PracticeRecordOutcome } | { readonly kind: 'changed' };

const RESULT_TABS = ['advice', 'stats', 'settings'] as const;
type ResultTab = (typeof RESULT_TABS)[number];

export class PracticeResultScreen {
  readonly root: HTMLDivElement;
  /** ボタンの上の追加の欄（7-B: リプレイを保存） */
  readonly extras: HTMLDivElement;
  /** 設定の欄を置く場所 */
  readonly settingsSlot: HTMLDivElement;
  private readonly drill: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly badges: HTMLDivElement;
  private readonly advice: HTMLDivElement;
  private readonly issues: HTMLOListElement;
  private readonly good: HTMLParagraphElement;
  private readonly facts: HTMLDivElement;
  private readonly retry: HTMLButtonElement;
  private readonly tabs: PanelTabs<ResultTab>;

  constructor(parent: HTMLElement, handlers: { onRetry: () => void; onList: () => void }) {
    const root = createScreen(parent, 'campaign-screen result-screen practice-result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    // 9-9c: 見出しとスコアの組（ふだんは今までどおり縦に並ぶ。背の低い画面は左に見出し・右にスコアの 1 段。practice-result.css）
    const head = el('div', 'practice-result-head', panel);
    const title = el('div', 'practice-result-title', head);
    el('div', 'ui-kicker campaign-kicker', title, 'PRACTICE RESULT');
    this.drill = el('div', 'result-pilot', title);
    const scoreBox = el('div', 'practice-result-scorebox', head);
    this.score = el('div', 'race-result-time practice-result-score', scoreBox);
    this.badges = el('div', 'race-result-badges', scoreBox);
    this.tabs = new PanelTabs(panel, RESULT_TABS, (tab) => t(`practice.result.tab.${tab}`));
    // 9-5c: その回の問題（優先度順に最大 3 つ・直し方つき）と良かった点
    this.advice = el('div', 'practice-advice', this.tabs.pane('advice'));
    el('div', 'practice-advice-heading', this.advice, t('practice.result.issuesHeading'));
    this.issues = el('ol', 'practice-issues', this.advice);
    this.good = el('p', 'practice-good', this.advice);
    this.facts = el('div', 'campaign-facts', this.tabs.pane('stats'));
    this.settingsSlot = el('div', 'practice-settings-slot', this.tabs.pane('settings'));
    this.tabs.show('advice');
    const bottom = el('div', 'practice-result-bottom', panel);
    this.extras = el('div', 'result-extras', bottom);
    const buttons = el('div', 'campaign-buttons', bottom);
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
    // 新しい結果は助言のタブから
    this.tabs.show('advice');
    const name = PRACTICE_DRILL_LABELS[r.drill].name;
    this.drill.textContent = `${name}${extras.pilotName ? `  /  PILOT ${extras.pilotName}` : ''}`;
    this.score.textContent = t('practice.result.score', { score: String(r.score) });
    this.badges.replaceChildren();
    if (record.kind === 'saved' && record.out.newBest) el('span', '', this.badges, 'NEW RECORD');
    else if (record.kind === 'saved' && record.out.newSettingsBest)
      el('span', '', this.badges, t('practice.result.settingsBest'));
    const ctx = adviceContext(extras.settings);
    this.issues.replaceChildren();
    for (const k of r.issues) el('li', 'practice-issue', this.issues, issueText(k, r, ctx));
    if (r.issues.length === 0)
      el('li', 'practice-issue is-none', this.issues, t('practice.result.noIssues'));
    this.good.textContent = goodText(r.good, r);
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

// 練習場（9-5）の結果。9-9c で「助言・指標・設定」のタブに分け、9-10d で中身を作り直した:
// - 上の帯: 課題名と時間（・パイロット・記録）、撃墜・命中率、スコア（大きく）と NEW RECORD
// - 助言のタブ: 直すとよい所を 1・2・3 の番号付きの札（短い見出し・直し方の文、右端に関係する数とその名前）。札は縦に並べて
//   空いた高さを分け合う。右の列に良かった点の札と「次の 1 回は 1 番だけを意識して」
// - 指標のタブ: 8 つを 4 × 2 の札（数を大きく・下に補足）。助言に出た指標はオレンジの枠と字、下に断り書き
// - 設定のタブ: その場で変えてすぐやり直せる設定の欄（9-5 のまま）
// - 下の帯: 「リプレイを保存」「練習場へ」「もう一度」（いつも見える）
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
import { practiceSettingsLabel } from './practice-text';
import {
  adviceContext,
  goodTitle,
  issueFix,
  issueTitle,
  type AdviceContext,
} from './practice-advice-text';
import {
  flaggedMetrics,
  GOOD_METRIC,
  ISSUE_METRIC,
  metricView,
  PRACTICE_METRICS,
} from './practice-metrics';
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
  private readonly meta: HTMLDivElement;
  private readonly records: HTMLDivElement;
  private readonly kills: HTMLSpanElement;
  private readonly accuracy: HTMLSpanElement;
  private readonly score: HTMLDivElement;
  private readonly badges: HTMLDivElement;
  private readonly issues: HTMLOListElement;
  private readonly good: HTMLDivElement;
  private readonly focusLine: HTMLParagraphElement;
  private readonly metrics: HTMLDivElement;
  private readonly flaggedNote: HTMLParagraphElement;
  private readonly thisSettings: HTMLParagraphElement;
  private readonly retry: HTMLButtonElement;
  private readonly tabs: PanelTabs<ResultTab>;

  constructor(parent: HTMLElement, handlers: { onRetry: () => void; onList: () => void }) {
    const root = createScreen(parent, 'campaign-screen result-screen practice-result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    // 上の帯: 左に課題名、中に撃墜・命中率、右にスコア
    const head = el('div', 'practice-result-head', panel);
    const title = el('div', 'practice-result-title', head);
    el('div', 'ui-kicker campaign-kicker', title, 'PRACTICE RESULT');
    this.drill = el('div', 'practice-result-drill', title);
    this.meta = el('div', 'practice-result-meta', title);
    this.records = el('div', 'practice-result-records', title);
    const chips = el('div', 'practice-result-chips', head);
    const chip = (label: string): HTMLSpanElement => {
      const c = el('div', 'practice-result-chip', chips);
      el('span', 'practice-result-chip-label', c, label);
      return el('span', 'practice-result-chip-value', c);
    };
    this.kills = chip(t('practice.metric.kills.label'));
    this.accuracy = chip(t('practice.metric.accuracy.label'));
    const scoreBox = el('div', 'practice-result-scorebox', head);
    el('span', 'practice-result-score-label', scoreBox, t('practice.result.scoreLabel'));
    this.score = el('div', 'race-result-time practice-result-score', scoreBox);
    this.badges = el('div', 'race-result-badges', scoreBox);
    this.tabs = new PanelTabs(panel, RESULT_TABS, (tab) => t(`practice.result.tab.${tab}`));
    // 助言: 左に番号付きの札、右の列に良かった点と一言
    const advice = el('div', 'practice-advice', this.tabs.pane('advice'));
    this.issues = el('ol', 'practice-issues', advice);
    this.issues.setAttribute('aria-label', t('practice.result.issuesHeading'));
    const side = el('div', 'practice-advice-side', advice);
    this.good = el('div', 'practice-good-card', side);
    this.focusLine = el('p', 'practice-focus', side, t('practice.result.focusFirst'));
    // 指標: 4 × 2 の札と断り書き
    const stats = this.tabs.pane('stats');
    this.metrics = el('div', 'practice-metrics', stats);
    this.flaggedNote = el('p', 'practice-flagged-note', stats, t('practice.result.flaggedNote'));
    this.thisSettings = el('p', 'practice-this-settings', this.tabs.pane('settings'));
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
    this.drill.textContent = PRACTICE_DRILL_LABELS[r.drill].name;
    const time = t('practice.result.time', { seconds: String(Math.round(r.seconds)) });
    this.meta.textContent = extras.pilotName ? `${time}  ·  PILOT ${extras.pilotName}` : time;
    this.records.textContent = recordLine(r, record);
    this.kills.textContent = metricView('kills', r).value;
    this.accuracy.textContent = metricView('accuracy', r).value;
    this.score.textContent = String(r.score);
    this.badges.replaceChildren();
    if (record.kind === 'saved' && record.out.newBest) el('span', '', this.badges, 'NEW RECORD');
    else if (record.kind === 'saved' && record.out.newSettingsBest)
      el('span', '', this.badges, t('practice.result.settingsBest'));
    this.renderAdvice(r, adviceContext(extras.settings));
    this.renderMetrics(r);
    this.thisSettings.textContent = t('practice.result.thisSettings', {
      settings: practiceSettingsLabel(extras.settings),
    });
  }

  private renderAdvice(r: Readonly<PracticeResult>, ctx: AdviceContext): void {
    this.issues.replaceChildren();
    r.issues.forEach((k, i) => {
      const m = metricView(ISSUE_METRIC[k], r);
      const li = el('li', 'practice-issue-card', this.issues);
      li.dataset.issue = k;
      el('span', 'practice-issue-num', li, String(i + 1));
      const body = el('div', 'practice-issue-body', li);
      el('div', 'practice-issue-title', body, issueTitle(k));
      el('div', 'practice-issue-fix', body, issueFix(k, ctx));
      metricChip(li, m.value, m.short);
    });
    if (r.issues.length === 0) {
      const li = el('li', 'practice-issue-card is-none', this.issues);
      const body = el('div', 'practice-issue-body', li);
      el('div', 'practice-issue-title', body, t('practice.result.noIssuesTitle'));
      el('div', 'practice-issue-fix', body, t('practice.result.noIssues'));
    }
    this.focusLine.hidden = r.issues.length === 0;
    this.good.replaceChildren();
    el('div', 'practice-good-label', this.good, t('practice.result.goodLabel'));
    el('div', 'practice-good-title', this.good, goodTitle(r.good, r));
    const gm = GOOD_METRIC[r.good];
    if (gm) {
      const m = metricView(gm, r);
      metricChip(this.good, m.value, m.short);
    }
  }

  private renderMetrics(r: Readonly<PracticeResult>): void {
    const flagged = flaggedMetrics(r.issues);
    this.metrics.replaceChildren();
    for (const id of PRACTICE_METRICS) {
      const m = metricView(id, r);
      const card = el('div', 'practice-metric', this.metrics);
      card.dataset.metric = id;
      card.classList.toggle('is-flagged', flagged.has(id));
      if (m.hint) card.title = m.hint;
      el('div', 'practice-metric-label', card, m.label);
      el('div', 'practice-metric-value', card, m.value);
      el('div', 'practice-metric-sub', card, m.sub);
    }
    this.flaggedNote.hidden = flagged.size === 0;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}

/** 札の右端の「数・名前」 */
function metricChip(parent: HTMLElement, value: string, name: string): void {
  const box = el('div', 'practice-card-metric', parent);
  el('span', 'practice-card-metric-value', box, value);
  el('span', 'practice-card-metric-name', box, name);
}

/** 上の帯の記録の 1 行（この設定の最高・課題の最高。途中で設定を変えたら記録しない旨） */
function recordLine(r: Readonly<PracticeResult>, record: PracticeRecordState): string {
  if (record.kind === 'changed') return t('practice.result.changed');
  const prev = record.out.previous;
  const settings = prev ? Math.max(prev.score, r.score) : r.score;
  const drill = Math.max(record.out.best?.score ?? 0, r.score);
  return t('practice.result.records', { settings: String(settings), drill: String(drill) });
}

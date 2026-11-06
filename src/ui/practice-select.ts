// 練習場（9-5）の課題の一覧: 左に課題 3 つ（最高スコア）、右に選んだ課題の「概要・記録・設定」のタブ（9-5d。それまでは
// 説明・設定ごとの記録（上位 5）・設定の欄を縦に積んでいて、スマホの横画面で縦にスクロールしていた）と「スタート」。
// 見た目はリングレースのコース一覧（race.css）と同じ部品
import { formatDate } from '../core/format';
import { t } from '../core/i18n';
import './campaign.css';
import './race.css';
import './practice.css';
import { findAircraftModel } from '../data/aircraft';
import {
  PRACTICE_CONFIG,
  PRACTICE_DRILL_LABELS,
  PRACTICE_DRILLS,
  type PracticeDrill,
} from '../data/practice';
import { practiceEntries, type PracticeRecords } from '../progression/practice-records';
import { el } from './hud-dom';
import { PanelTabs } from './panel-tabs';
import { formatRatio, practiceSettingsLabel } from './practice-text';
import { createButton, createScreen, setScreenShown } from './screen';

const TABS = ['overview', 'records', 'settings'] as const;
type Tab = (typeof TABS)[number];

interface Entry {
  readonly drill: PracticeDrill;
  readonly button: HTMLButtonElement;
  readonly best: HTMLSpanElement;
}

export class PracticeSelectScreen {
  readonly root: HTMLDivElement;
  /** 設定の欄を置く場所（practice-link.ts が入れる） */
  readonly settingsSlot: HTMLDivElement;
  private readonly entries: Entry[] = [];
  private readonly title: HTMLHeadingElement;
  private readonly note: HTMLParagraphElement;
  private readonly facts: HTMLDivElement;
  private readonly table: HTMLTableElement;
  private readonly start: HTMLButtonElement;
  private readonly tabs: PanelTabs<Tab>;
  selected: PracticeDrill = 'static';

  constructor(
    parent: HTMLElement,
    private readonly source: {
      records(): Readonly<PracticeRecords>;
      aircraftName(): string;
      /** 今の設定の見出し（practiceSettingsKey） */
      settingsKey(): string;
    },
    handlers: { onStart: (drill: PracticeDrill) => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen race-screen practice-screen');
    el('h2', 'ui-heading campaign-heading', root, t('practice.select.heading'));
    el('p', 'campaign-text practice-lead', root, t('practice.select.lead'));
    root.classList.add('practice-select');
    const layout = el('div', 'race-layout', root);
    const list = el('div', 'race-course-list', layout);
    for (const drill of PRACTICE_DRILLS) {
      const button = createButton(list, 'ui-button ui-item mission-entry race-course', '', () => {
        this.select(drill);
      });
      button.dataset.drill = drill;
      const head = el('span', 'mission-entry-head', button);
      el(
        'span',
        'mission-entry-no',
        head,
        t('practice.select.duration', { seconds: PRACTICE_CONFIG.durations[drill] }),
      );
      el('span', 'mission-entry-title', button, PRACTICE_DRILL_LABELS[drill].name);
      const best = el('span', 'race-course-best', button);
      this.entries.push({ drill, button, best });
    }
    const detail = el('div', 'race-detail practice-detail', layout);
    this.tabs = new PanelTabs(detail, TABS, (tab) => t(`practice.select.tab.${tab}`));
    const overview = this.tabs.pane('overview');
    this.title = el('h3', 'ui-title race-detail-title', overview);
    this.note = el('p', 'campaign-text', overview);
    // 背の低い画面は上の説明を隠し、ここに出す（CSS）
    el('p', 'campaign-text practice-lead-inline', overview, t('practice.select.lead'));
    this.facts = el('div', 'race-facts', overview);
    const records = this.tabs.pane('records');
    el(
      'div',
      'campaign-label',
      records,
      t('practice.select.records', { count: PRACTICE_CONFIG.listRows }),
    );
    this.table = el('table', 'race-times practice-records', records);
    this.settingsSlot = el('div', 'practice-settings-slot', this.tabs.pane('settings'));
    this.showTab('overview');
    const buttons = el('div', 'campaign-buttons', root);
    createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('campaign.backToModes'),
      handlers.onBack,
    );
    this.start = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('practice.select.start'),
      () => {
        handlers.onStart(this.selected);
      },
    );
    this.root = root;
  }

  /** タブを切り替える（課題を選び直しても今のタブのまま） */
  showTab(tab: Tab): void {
    this.tabs.show(tab);
  }

  select(drill: PracticeDrill): void {
    this.selected = drill;
    this.refresh();
  }

  /** 一覧の最高・詳細・記録をセーブと今の設定に合わせる */
  refresh(): void {
    const records = this.source.records();
    for (const { drill, button, best } of this.entries) {
      const top = practiceEntries(records, drill)[0];
      best.textContent = top
        ? t('practice.select.best', { score: String(top.score) })
        : t('practice.select.notRun');
      button.classList.toggle('is-selected', drill === this.selected);
      button.setAttribute('aria-pressed', String(drill === this.selected));
    }
    const d = this.selected;
    const label = PRACTICE_DRILL_LABELS[d];
    this.title.textContent = label.name;
    this.note.textContent = label.note;
    this.facts.replaceChildren();
    const fact = (name: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, name);
      el('span', 'campaign-fact-value', row, value);
    };
    fact(
      t('campaign.briefing.timeLimit'),
      t('practice.select.duration', { seconds: PRACTICE_CONFIG.durations[d] }),
    );
    fact(t('campaign.briefing.aircraft'), this.source.aircraftName());
    fact(t('practice.select.settings'), practiceSettingsLabel(this.source.settingsKey(), true));
    fact(t('practice.select.rules'), t('practice.select.rulesValue'));
    this.renderRecords(records, d);
  }

  private renderRecords(records: Readonly<PracticeRecords>, d: PracticeDrill): void {
    this.table.replaceChildren();
    const rows = practiceEntries(records, d).slice(0, PRACTICE_CONFIG.listRows);
    if (rows.length === 0) {
      el('td', '', el('tr', '', this.table), t('practice.select.noRecords'));
      return;
    }
    const current = this.source.settingsKey();
    rows.forEach((e, i) => {
      const tr = el('tr', e.settings === current ? 'is-current' : '', this.table);
      el('td', '', tr, `${i + 1}.`);
      el('td', 'practice-records-score', tr, String(e.score));
      el(
        'td',
        '',
        tr,
        t('practice.select.row', { kills: String(e.kills), accuracy: formatRatio(e.accuracy) }),
      );
      const name = findAircraftModel(e.aircraftId)?.name ?? e.aircraftId;
      const label = `${practiceSettingsLabel(e.settings, true)} / ${name}`;
      el('td', 'practice-records-settings', tr, label).title =
        `${practiceSettingsLabel(e.settings)} / ${name}`;
      el('td', '', tr, formatDate(e.date));
    });
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) return;
    this.refresh();
    this.start.focus({ preventScroll: true });
  }
}

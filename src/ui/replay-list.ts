// リプレイの一覧（7-B）: モード選択の「リプレイ」から。左に一覧（モード・日付・時間・結果。自動保存は「自動」、名前を付けた
// 保存は名前）、右に選んだ記録の詳細と操作（再生・名前を付けて保存・名前の変更・書き出し・削除）。下に容量と読み込み・戻る
import { APP_VERSION } from 'virtual:app-info';
import { formatDateTime } from '../core/format';
import { t } from '../core/i18n';
import { REPLAY_CONFIG } from '../data/replay';
import { findAircraftModel } from '../data/aircraft';
import {
  formatClock,
  replayOutcomeLabel,
  replayTitle,
  replayVersionNotice,
} from '../replay/outcome';
import type { ReplayEntry, ReplayUsage } from '../replay/store';
import { REPLAY_MODE_LABELS } from '../replay/types';
import { el } from './hud-dom';
import { stopKeys } from './replay-save';
import { createButton, createScreen, setScreenShown } from './screen';

export interface ReplayListHandlers {
  readonly onPlay: (entry: ReplayEntry) => void;
  readonly onSave: (entry: ReplayEntry, name: string) => void;
  readonly onRename: (entry: ReplayEntry, name: string) => void;
  readonly onExport: (entry: ReplayEntry) => void;
  readonly onDelete: (entry: ReplayEntry) => void;
  readonly onImport: () => void;
  readonly onBack: () => void;
}

/** ISO の時刻 → 今の言語の日時（ja「2026/10/31 14:05」）。不正な時刻は空 */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateTime(d);
}

/** バイト → 「12.3 KB」 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export class ReplayListScreen {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly usage: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private entries: ReplayEntry[] = [];
  private selectedId: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly h: ReplayListHandlers,
  ) {
    const root = createScreen(parent, 'campaign-screen race-screen replay-screen');
    el('h2', 'ui-heading campaign-heading', root, t('replay.list.heading'));
    this.usage = el('div', 'campaign-balance replay-usage', root);
    const layout = el('div', 'race-layout', root);
    this.list = el('div', 'race-course-list replay-list', layout);
    this.detail = el('div', 'race-detail replay-detail', layout);
    this.message = el('div', 'replay-message', root);
    const buttons = el('div', 'campaign-buttons', root);
    createButton(buttons, 'ui-button is-ghost campaign-back', t('replay.list.back'), h.onBack);
    createButton(
      buttons,
      'ui-button campaign-go replay-import',
      t('replay.list.import'),
      h.onImport,
    );
    this.root = root;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
  }

  /** 一番下に一言（保存の上限・読み込みの失敗など） */
  say(text: string): void {
    this.message.textContent = text;
  }

  /** 一覧と容量を入れ直す */
  update(entries: readonly ReplayEntry[], usage: ReplayUsage): void {
    this.entries = [...entries];
    if (!this.entries.some((e) => e.id === this.selectedId))
      this.selectedId = this.entries[0]?.id ?? null;
    this.usage.textContent = t('replay.list.usage', {
      saved: usage.savedCount,
      savedMax: REPLAY_CONFIG.savedMax,
      savedSize: formatBytes(usage.savedBytes),
      auto: usage.autoCount,
      autoMax: REPLAY_CONFIG.autoKeep,
      autoSize: formatBytes(usage.autoBytes),
    });
    this.render();
  }

  private render(): void {
    this.list.replaceChildren();
    if (this.entries.length === 0) {
      el('p', 'campaign-text', this.list, t('replay.list.empty'));
    }
    for (const e of this.entries) {
      const hd = e.header;
      const b = createButton(this.list, 'ui-button ui-item mission-entry replay-entry', '', () => {
        this.selectedId = e.id;
        this.render();
      });
      const head = el('span', 'mission-entry-head', b);
      el('span', 'mission-entry-no', head, REPLAY_MODE_LABELS[hd.mode]);
      el(
        'span',
        'mission-entry-level',
        head,
        t(e.kind === 'saved' ? 'replay.list.kindSaved' : 'replay.list.kindAuto'),
      );
      el('span', 'mission-entry-title', b, e.kind === 'saved' ? e.name : replayTitle(hd));
      const sub = el('span', 'race-course-best replay-entry-sub', b);
      sub.textContent = `${formatLocalDate(hd.date)}  ${formatClock(hd.steps / 60)}  ${replayOutcomeLabel(hd.outcome) ?? ''}`;
      b.classList.toggle('is-selected', e.id === this.selectedId);
      b.setAttribute('aria-pressed', String(e.id === this.selectedId));
    }
    this.renderDetail();
  }

  private renderDetail(): void {
    const d = this.detail;
    d.replaceChildren();
    const e = this.entries.find((x) => x.id === this.selectedId);
    if (!e) return;
    const hd = e.header;
    const title = replayTitle(hd);
    el('h3', 'ui-title race-detail-title', d, e.kind === 'saved' ? e.name : title);
    const facts = el('div', 'race-facts', d);
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact(
      t('replay.list.factMode'),
      t('replay.list.modeValue', { mode: REPLAY_MODE_LABELS[hd.mode], title }),
    );
    fact(t('replay.list.factDate'), formatLocalDate(hd.date));
    fact(t('replay.list.factLength'), formatClock(hd.steps / 60));
    fact(t('replay.list.factResult'), replayOutcomeLabel(hd.outcome) ?? '—');
    fact(t('replay.list.factAircraft'), findAircraftModel(hd.aircraftId)?.name ?? hd.aircraftId);
    fact(t('replay.list.factPilot'), hd.pilotName);
    fact(t('replay.list.factSize'), formatBytes(e.size));
    const versionNote =
      hd.simVersion !== REPLAY_CONFIG.simVersion
        ? t('replay.list.oldVersion')
        : replayVersionNotice(hd, APP_VERSION);
    if (versionNote) el('p', 'replay-warn', d, versionNote);
    const name = el('input', 'ui-field replay-name', d);
    name.type = 'text';
    name.maxLength = REPLAY_CONFIG.nameMax;
    name.value = e.kind === 'saved' ? e.name : title;
    name.setAttribute('aria-label', t('replay.save.nameLabel'));
    stopKeys(name);
    const row = el('div', 'replay-actions', d);
    createButton(row, 'ui-button is-primary', t('replay.list.play'), () => {
      this.h.onPlay(e);
    });
    if (e.kind === 'auto')
      createButton(row, 'ui-button', t('replay.list.saveAs'), () => {
        this.h.onSave(e, name.value);
      });
    else
      createButton(row, 'ui-button', t('replay.list.rename'), () => {
        this.h.onRename(e, name.value);
      });
    createButton(row, 'ui-button', t('replay.list.export'), () => {
      this.h.onExport(e);
    });
    createButton(row, 'ui-button is-danger', t('replay.list.delete'), () => {
      this.h.onDelete(e);
    });
  }
}

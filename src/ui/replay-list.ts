// リプレイの一覧（7-B）: モード選択の「リプレイ」から。左に一覧（モード・日付・時間・結果。自動保存は「自動」、名前を付けた
// 保存は名前）、右に選んだ記録の詳細と操作（再生・名前を付けて保存・名前の変更・書き出し・削除）。下に容量と読み込み・戻る
import { REPLAY_CONFIG } from '../data/replay';
import { findAircraftModel } from '../data/aircraft';
import { formatClock } from '../replay/outcome';
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

/** ISO の時刻 → ローカルの「2026-10-31 14:05」 */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
    el('h2', 'ui-heading campaign-heading', root, 'リプレイ');
    this.usage = el('div', 'campaign-balance replay-usage', root);
    const layout = el('div', 'race-layout', root);
    this.list = el('div', 'race-course-list replay-list', layout);
    this.detail = el('div', 'race-detail replay-detail', layout);
    this.message = el('div', 'replay-message', root);
    const buttons = el('div', 'campaign-buttons', root);
    createButton(buttons, 'ui-button is-ghost campaign-back', '← モード選択', h.onBack);
    createButton(buttons, 'ui-button campaign-go replay-import', 'ファイルを読み込む', h.onImport);
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
    this.usage.textContent =
      `保存 ${String(usage.savedCount)} / ${String(REPLAY_CONFIG.savedMax)}（${formatBytes(usage.savedBytes)}）` +
      `・自動 ${String(usage.autoCount)} / ${String(REPLAY_CONFIG.autoKeep)}（${formatBytes(usage.autoBytes)}）`;
    this.render();
  }

  private render(): void {
    this.list.replaceChildren();
    if (this.entries.length === 0) {
      el(
        'p',
        'campaign-text',
        this.list,
        'まだリプレイがありません。シングルプレイで飛ぶと直近 10 本が自動で残ります。',
      );
    }
    for (const e of this.entries) {
      const hd = e.header;
      const b = createButton(this.list, 'ui-button ui-item mission-entry replay-entry', '', () => {
        this.selectedId = e.id;
        this.render();
      });
      const head = el('span', 'mission-entry-head', b);
      el('span', 'mission-entry-no', head, REPLAY_MODE_LABELS[hd.mode]);
      el('span', 'mission-entry-level', head, e.kind === 'saved' ? '保存' : '自動');
      el('span', 'mission-entry-title', b, e.kind === 'saved' ? e.name : hd.title);
      const sub = el('span', 'race-course-best replay-entry-sub', b);
      sub.textContent = `${formatLocalDate(hd.date)}  ${formatClock(hd.steps / 60)}  ${hd.outcome?.label ?? ''}`;
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
    el('h3', 'ui-title race-detail-title', d, e.kind === 'saved' ? e.name : hd.title);
    const facts = el('div', 'race-facts', d);
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact('モード', `${REPLAY_MODE_LABELS[hd.mode]}・${hd.title}`);
    fact('日付', formatLocalDate(hd.date));
    fact('時間', formatClock(hd.steps / 60));
    fact('結果', hd.outcome?.label ?? '—');
    fact('機体', findAircraftModel(hd.aircraftId)?.name ?? hd.aircraftId);
    fact('パイロット', hd.pilotName);
    fact('大きさ', formatBytes(e.size));
    if (hd.simVersion !== REPLAY_CONFIG.simVersion)
      el(
        'p',
        'replay-warn',
        d,
        '古い版の記録です。今の版では同じように再現できないことがあります。',
      );
    const name = el('input', 'ui-field replay-name', d);
    name.type = 'text';
    name.maxLength = REPLAY_CONFIG.nameMax;
    name.value = e.kind === 'saved' ? e.name : hd.title;
    name.setAttribute('aria-label', 'リプレイの名前');
    stopKeys(name);
    const row = el('div', 'replay-actions', d);
    createButton(row, 'ui-button is-primary', '再生', () => {
      this.h.onPlay(e);
    });
    if (e.kind === 'auto')
      createButton(row, 'ui-button', '名前を付けて保存', () => {
        this.h.onSave(e, name.value);
      });
    else
      createButton(row, 'ui-button', '名前を変更', () => {
        this.h.onRename(e, name.value);
      });
    createButton(row, 'ui-button', '書き出す', () => {
      this.h.onExport(e);
    });
    createButton(row, 'ui-button is-danger', '削除', () => {
      this.h.onDelete(e);
    });
  }
}

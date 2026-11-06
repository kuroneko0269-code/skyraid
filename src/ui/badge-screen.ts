// 勲章（9-10・9-10b・9-10c）の一覧: モード選択の「勲章」から。モード選択の上に重ねる（情報・ランキングと同じ）。
// 9-10c: 上の帯に全体の進み具合と次の節目、左の列にカテゴリ（取った数 / 全体。押すと切り替え）、中央に状態の切り替え・並び順と
// 番号つきの一覧（印・番号・条件の文・進み具合）、右に詳細（badge-detail.ts）。左の列・一覧・詳細はそれぞれの中だけスクロールする。
// 背の低く狭い画面（568×320）はカテゴリを上の横一列に。行の組み立ては badge-view.ts（DOM 非依存）。文字は textContent だけで入れる
import './badges.css';
import { formatCredits, formatInteger } from '../core/format';
import type { GameState } from '../core/game-state';
import { t } from '../core/i18n';
import { BADGE_GROUPS, badgeNumber, type BadgeGroup } from '../data/badges';
import { badgeTotals, nextMilestone } from '../progression/badges';
import type { SaveData } from '../progression/save';
import { renderBadgeDetail } from './badge-detail';
import {
  allBadgeRows,
  BADGE_SORTS,
  BADGE_STATUSES,
  filterRows,
  groupCounts,
  parseBadgeFilter,
  rowValue,
  statusCounts,
  type BadgeFilter,
  type BadgeRow,
} from './badge-view';
import { el } from './hud-dom';
import type { ModeSelectScreen } from './mode-select';
import { createButton, createScreen, setScreenShown } from './screen';

export interface BadgeScreenSource {
  badges(): Readonly<SaveData>;
}

export class BadgeScreen {
  readonly root: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private readonly overview: HTMLSpanElement;
  private readonly milestone: HTMLSpanElement;
  private readonly groups: HTMLDivElement;
  private readonly statuses: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly filter: BadgeFilter = { group: 'all', status: 'all', sort: 'number' };
  private all: BadgeRow[] = [];
  private rows: BadgeRow[] = [];
  private selected: string | null = null;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly modeSelect: ModeSelectScreen,
    private readonly game: GameState,
    private readonly source: BadgeScreenSource,
  ) {
    const root = createScreen(parent, 'badge-screen menu-fixed');
    const top = el('div', 'badge-top', root);
    createButton(top, 'ui-button is-ghost menu-back', t('badges.back'), () => {
      this.close();
    });
    el('h2', 'ui-heading badge-heading', top, t('badges.title'));
    const summary = el('div', 'badge-summary', top);
    const bar = el('span', 'badge-total-bar', summary);
    bar.setAttribute('aria-hidden', 'true');
    this.fill = el('span', 'badge-total-fill', bar);
    this.overview = el('span', 'badge-overview', summary);
    this.milestone = el('span', 'badge-milestone', summary);
    const body = el('div', 'badge-body', root);
    this.groups = el('div', 'badge-groups', body);
    this.groups.setAttribute('role', 'group');
    this.groups.setAttribute('aria-label', t('badges.filter.group'));
    const main = el('div', 'badge-main', body);
    const tools = el('div', 'badge-tools', main);
    this.statuses = el('div', 'badge-statuses', tools);
    this.statuses.setAttribute('role', 'group');
    this.statuses.setAttribute('aria-label', t('badges.filter.status'));
    const sort = el('select', 'ui-field badge-select', tools);
    sort.setAttribute('aria-label', t('badges.sort.label'));
    sort.title = t('badges.sort.label');
    for (const s of BADGE_SORTS) el('option', '', sort, t(`badges.sort.${s}`)).value = s;
    sort.addEventListener('change', () => {
      parseBadgeFilter(this.filter, 'sort', sort.value);
      this.render(true);
    });
    this.list = el('div', 'badge-list', main);
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('badges.list'));
    this.list.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    this.detail = el('div', 'ui-panel badge-detail', body);
    this.detail.setAttribute('aria-live', 'polite');
    this.root = root;
    modeSelect.addOverlay(() => this.close());
  }

  show(): void {
    if (this.game.state !== 'mode_select') return;
    this.open = true;
    this.render(true);
    setScreenShown(this.modeSelect.root, false);
    setScreenShown(this.root, true);
    this.root.querySelector<HTMLButtonElement>('.menu-back')?.focus({ preventScroll: true });
  }

  /** 開いていれば閉じて true（Esc・‹ モード選択） */
  close(): boolean {
    if (!this.open) return false;
    this.open = false;
    setScreenShown(this.root, false);
    if (this.game.state === 'mode_select') this.modeSelect.reveal();
    return true;
  }

  private setFilter(key: 'group' | 'status', value: string): void {
    parseBadgeFilter(this.filter, key, value);
    this.render(true);
  }

  /** 全部を描き直す（toTop: 一覧を先頭へ） */
  private render(toTop = false): void {
    const data = this.source.badges();
    const totals = badgeTotals(data.badges);
    const pct = Math.floor((totals.earned / Math.max(1, totals.total)) * 100);
    this.fill.style.width = `${String(pct)}%`;
    this.overview.textContent = t('badges.overview', {
      earned: formatInteger(totals.earned),
      total: formatInteger(totals.total),
      pct,
    });
    const next = nextMilestone(data.badges);
    this.milestone.textContent =
      next.at <= totals.total
        ? t('badges.milestone', { left: next.left, credits: formatCredits(next.credits) })
        : t('badges.milestoneDone');
    this.all = allBadgeRows(data);
    this.renderGroups();
    this.renderStatuses();
    this.rows = filterRows(this.all, this.filter);
    if (!this.rows.some((r) => r.id === this.selected)) this.selected = this.rows[0]?.id ?? null;
    this.list.replaceChildren();
    if (this.rows.length === 0) el('div', 'badge-empty', this.list, t('badges.empty'));
    for (const row of this.rows) this.renderItem(row);
    if (toTop) this.list.scrollTop = 0;
    this.renderDetail();
  }

  private renderGroups(): void {
    const counts = groupCounts(this.all);
    this.groups.replaceChildren();
    for (const g of ['all', ...BADGE_GROUPS] as const) {
      const c = counts[g];
      const b = this.chip(this.groups, 'badge-group', g === this.filter.group, () => {
        this.setFilter('group', g);
      });
      b.dataset.group = g;
      el('span', 'badge-group-name', b, groupLabel(g));
      el('span', 'badge-group-count', b, `${String(c.earned)}/${String(c.total)}`);
    }
  }

  private renderStatuses(): void {
    const counts = statusCounts(this.all, this.filter.group);
    this.statuses.replaceChildren();
    for (const s of ['all', ...BADGE_STATUSES] as const) {
      const b = this.chip(this.statuses, 'badge-status', s === this.filter.status, () => {
        this.setFilter('status', s);
      });
      b.dataset.status = s;
      el('span', 'badge-status-name', b, t(`badges.status.${s}`));
      el('span', 'badge-status-count', b, String(counts[s]));
    }
  }

  private chip(
    parent: HTMLElement,
    cls: string,
    on: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = el('button', cls, parent);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', onClick);
    return b;
  }

  private renderItem(row: BadgeRow): void {
    const item = el('button', 'badge-item', this.list);
    item.type = 'button';
    item.dataset.id = row.id;
    item.dataset.state = row.status;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(row.id === this.selected));
    item.tabIndex = row.id === this.selected ? 0 : -1;
    el('span', 'badge-mark', item).setAttribute('aria-hidden', 'true');
    el('span', 'badge-item-no', item, badgeNumber(row.def));
    el('span', 'badge-item-name', item, row.title);
    el('span', 'badge-item-value', item, rowValue(row));
    item.addEventListener('click', () => {
      this.pick(row.id, false);
    });
  }

  /** 選び直す（同じ段の勲章から選んだものが一覧に無ければ、詳細だけ替える） */
  private pick(id: string, focus: boolean): void {
    this.selected = id;
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('.badge-item')) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) {
        b.focus({ preventScroll: true });
        b.scrollIntoView({ block: 'nearest' });
      }
    }
    this.renderDetail();
  }

  /** 一覧の上下の矢印で選び直す */
  private onKey(e: KeyboardEvent): void {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || this.rows.length === 0) return;
    e.preventDefault();
    const i = this.rows.findIndex((r) => r.id === this.selected);
    const next = this.rows[Math.max(0, Math.min(this.rows.length - 1, i + step))];
    if (next) this.pick(next.id, true);
  }

  private renderDetail(): void {
    const row = this.all.find((r) => r.id === this.selected) ?? null;
    renderBadgeDetail(this.detail, row, this.all, this.source.badges(), (id) => {
      this.pick(id, true);
    });
  }
}

/** カテゴリの短い名前（「すべて」も） */
export function groupLabel(g: BadgeGroup | 'all'): string {
  return t(`badges.groups.${g}`);
}

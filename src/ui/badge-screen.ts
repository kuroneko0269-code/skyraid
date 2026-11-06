// 勲章（9-10・9-10b）の一覧: モード選択の「勲章」から。モード選択の上に重ねる（情報・ランキングと同じ）。
// 上に取った数と次の節目、カテゴリ・状態・並びの選択と件数。左に名前だけの一覧（取った段階の色の印・進行中は半分の印）、
// 選ぶと右に詳細（カテゴリ・条件・進み具合のバー・取った日・報酬）。隠し勲章は取るまで名前と条件が「？？？」。
// 一覧の並べ替え・絞り込みは badge-view.ts（DOM 非依存）。文字は textContent だけで入れる
import './badges.css';
import { formatCredits, formatDate } from '../core/format';
import type { GameState } from '../core/game-state';
import { t } from '../core/i18n';
import { BADGE_GROUPS, badgeCondition, badgeTierName, badgeTiers, findBadge } from '../data/badges';
import { badgeTotals, nextMilestone } from '../progression/badges';
import type { SaveData } from '../progression/save';
import {
  BADGE_SORTS,
  BADGE_STATUSES,
  badgeRows,
  parseBadgeFilter,
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
  private readonly overview: HTMLSpanElement;
  private readonly milestone: HTMLSpanElement;
  private readonly count: HTMLSpanElement;
  private readonly list: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly filter: BadgeFilter = { group: 'all', status: 'all', sort: 'default' };
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
    const top = el('div', 'menu-top', root);
    const header = el('div', 'menu-header', top);
    createButton(header, 'ui-button is-ghost menu-back', t('badges.back'), () => {
      this.close();
    });
    el('h2', 'ui-heading menu-heading', header, t('badges.title'));
    const bar = el('div', 'badge-bar', top);
    const summary = el('div', 'badge-summary', bar);
    this.overview = el('span', 'badge-overview', summary);
    this.milestone = el('span', 'badge-milestone', summary);
    const tools = el('div', 'badge-tools', bar);
    this.select(
      tools,
      t('badges.filter.group'),
      [
        ['all', t('badges.filter.allGroups')],
        ...BADGE_GROUPS.map((g): [string, string] => [g, t(`badges.groups.${g}`)]),
      ],
      'group',
    );
    this.select(
      tools,
      t('badges.filter.status'),
      [
        ['all', t('badges.filter.allStatuses')],
        ...BADGE_STATUSES.map((s): [string, string] => [s, t(`badges.status.${s}`)]),
      ],
      'status',
    );
    this.select(
      tools,
      t('badges.sort.label'),
      BADGE_SORTS.map((s): [string, string] => [
        s,
        t('badges.sort.option', { name: t(`badges.sort.${s}`) }),
      ]),
      'sort',
    );
    this.count = el('span', 'badge-count', tools);
    const split = el('div', 'badge-split', root);
    this.list = el('div', 'badge-list', split);
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', t('badges.list'));
    this.list.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    this.detail = el('div', 'ui-panel badge-detail', split);
    this.detail.setAttribute('aria-live', 'polite');
    this.root = root;
    modeSelect.addOverlay(() => this.close());
  }

  show(): void {
    if (this.game.state !== 'mode_select') return;
    this.open = true;
    this.render();
    setScreenShown(this.modeSelect.root, false);
    setScreenShown(this.root, true);
    this.list.scrollTop = 0;
    this.root.querySelector<HTMLButtonElement>('.menu-back')?.focus({ preventScroll: true });
  }

  /** 開いていれば閉じて true（Esc・← モード選択へ） */
  close(): boolean {
    if (!this.open) return false;
    this.open = false;
    setScreenShown(this.root, false);
    if (this.game.state === 'mode_select') this.modeSelect.reveal();
    return true;
  }

  /** 選択の箱（見出しは aria-label と title。「全カテゴリ」「並び: 標準」のように中身だけで分かる文にする） */
  private select(
    parent: HTMLElement,
    label: string,
    options: readonly [string, string][],
    key: keyof BadgeFilter,
  ): void {
    const s = el('select', 'ui-field badge-select', parent);
    s.setAttribute('aria-label', label);
    s.title = label;
    for (const [value, text] of options) {
      const o = el('option', '', s, text);
      o.value = value;
    }
    s.addEventListener('change', () => {
      parseBadgeFilter(this.filter, key, s.value);
      this.render();
      this.list.scrollTop = 0;
    });
  }

  private render(): void {
    const data = this.source.badges();
    const totals = badgeTotals(data.badges);
    const pct = Math.floor((totals.earned / Math.max(1, totals.total)) * 100);
    this.overview.textContent = t('badges.overview', {
      earned: totals.earned,
      total: totals.total,
      pct,
    });
    const next = nextMilestone(data.badges);
    this.milestone.textContent =
      next.at <= totals.total
        ? t('badges.milestone', { left: next.left, credits: formatCredits(next.credits) })
        : t('badges.milestoneDone');
    this.rows = badgeRows(data, this.filter);
    this.count.textContent = t('badges.shown', { count: this.rows.length });
    this.list.replaceChildren();
    if (this.rows.length === 0) el('div', 'badge-empty', this.list, t('badges.empty'));
    for (const row of this.rows) this.renderItem(row);
    if (this.selected !== null && !this.rows.some((r) => r.id === this.selected))
      this.selected = null;
    this.renderDetail(data);
  }

  private renderItem(row: BadgeRow): void {
    const item = el('button', 'badge-item', this.list);
    item.type = 'button';
    item.dataset.id = row.id;
    item.dataset.state = row.status;
    item.dataset.tier = String(row.markTier);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(row.id === this.selected));
    item.tabIndex =
      row.id === this.selected || (this.selected === null && item === this.list.firstChild)
        ? 0
        : -1;
    el('span', 'badge-mark', item).setAttribute('aria-hidden', 'true');
    el('span', 'badge-item-name', item, row.title);
    item.addEventListener('click', () => {
      this.pick(row.id, false);
    });
  }

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
    this.renderDetail(this.source.badges());
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

  private renderDetail(data: Readonly<SaveData>): void {
    const d = this.detail;
    d.replaceChildren();
    const row = this.rows.find((r) => r.id === this.selected);
    const def = row ? findBadge(row.id) : undefined;
    if (!row || !def) {
      el('div', 'badge-detail-pick', d, t('badges.pick'));
      return;
    }
    const tiers = badgeTiers(def);
    const times = data.badges.earned[def.id] ?? [];
    const have = times.length;
    const head = el('div', 'badge-detail-head', d);
    const mark = el('span', 'badge-mark is-large', head);
    mark.setAttribute('aria-hidden', 'true');
    head.dataset.state = row.status;
    head.dataset.tier = String(row.markTier);
    el('h3', 'badge-detail-name', head, row.title);
    const tags = el('div', 'badge-tags', d);
    el('span', 'badge-tag', tags, t(`badges.groups.${def.group}`));
    if (def.skill) el('span', 'badge-tag is-skill', tags, t('badges.skill'));
    if (tiers > 1) {
      const pips = el('span', 'badge-pips', tags);
      for (let k = 1; k <= tiers; k++)
        el('span', `badge-pip${k <= have ? ' is-on' : ''}`, pips).dataset.tier = String(k);
    }
    const masked = row.masked;
    this.field(
      d,
      t('badges.detail.condition'),
      masked ? t('badges.hiddenNote') : this.condition(def.id, tiers, have),
    );
    if (!masked && row.progress && have < tiers) {
      const bar = el('div', 'badge-progress', d);
      const fill = el('span', 'badge-progress-fill', bar);
      const p = row.progress;
      fill.style.width = `${String(Math.round((p.current / Math.max(1, p.goal)) * 100))}%`;
      el(
        'span',
        'badge-progress-text',
        bar,
        t('badges.progress', { current: p.current, goal: p.goal }),
      );
    }
    const dates =
      times.length > 0
        ? times
            .map((at, i) =>
              tiers > 1 ? `${badgeTierName(i + 1)} ${formatDate(at)}` : formatDate(at),
            )
            .join(' · ')
        : t('badges.detail.notEarned');
    this.field(d, t('badges.detail.earned'), dates);
    const reward = def.rewards[Math.min(have, tiers - 1)] ?? 0;
    this.field(
      d,
      t('badges.detail.reward'),
      t('badges.rewardOnce', { credits: formatCredits(reward) }),
    );
    if (def.stat && !masked) {
      const since = data.stats.since;
      el(
        'div',
        'badge-since',
        d,
        since > 0 ? t('badges.since', { date: formatDate(since) }) : t('badges.sinceNone'),
      );
    }
  }

  /** 条件（段階付きは次の段階。取り終えたら金の条件） */
  private condition(id: string, tiers: number, have: number): string {
    if (tiers <= 1) return badgeCondition(id);
    const next = Math.min(tiers, have + 1);
    return `${badgeTierName(next)}: ${badgeCondition(id, next)}`;
  }

  private field(parent: HTMLElement, label: string, value: string): void {
    const f = el('div', 'badge-field', parent);
    el('span', 'badge-field-label', f, label);
    el('span', 'badge-field-value', f, value);
  }
}

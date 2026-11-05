// 勲章（9-10）の一覧: モード選択の「勲章」から。モード選択の上に重ねる（情報・ランキングと同じ）。
// 上に取った数と段階の数、まとまりごとに 1 行ずつ: 印（取った段階の色）・名前・「補助ふつう以上」・条件（段階付きは次の段階の条件）・
// 取った日・報酬・記録から数えられるものは進み具合（バー）。文字は textContent だけで入れる
import './badges.css';
import { formatCredits, formatDate } from '../core/format';
import type { GameState } from '../core/game-state';
import { t } from '../core/i18n';
import {
  BADGE_GROUPS,
  BADGES,
  badgeCondition,
  badgeName,
  badgeTierName,
  badgeTiers,
  type BadgeDef,
} from '../data/badges';
import { badgeTotals, earnedTier, recordBadges, type RecordBadge } from '../progression/badges';
import type { SaveData } from '../progression/save';
import { el } from './hud-dom';
import type { ModeSelectScreen } from './mode-select';
import { createButton, createScreen, setScreenShown } from './screen';

export interface BadgeScreenSource {
  badges(): Readonly<SaveData>;
}

export class BadgeScreen {
  readonly root: HTMLDivElement;
  private readonly summary: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly scroller: HTMLDivElement;
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
    this.summary = el('div', 'badge-summary', top);
    this.scroller = el('div', 'menu-scroll', root);
    this.list = el('div', 'badge-list', this.scroller);
    this.root = root;
    modeSelect.addOverlay(() => this.close());
  }

  show(): void {
    if (this.game.state !== 'mode_select') return;
    this.open = true;
    this.render();
    setScreenShown(this.modeSelect.root, false);
    setScreenShown(this.root, true);
    this.scroller.scrollTop = 0;
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

  private render(): void {
    const data = this.source.badges();
    const totals = badgeTotals(data.badges);
    this.summary.textContent = t('badges.summary', {
      earned: totals.earned,
      total: totals.total,
      tiers: totals.tiers,
      totalTiers: totals.totalTiers,
    });
    const records = recordBadges(data);
    this.list.replaceChildren();
    for (const group of BADGE_GROUPS) {
      const defs = BADGES.filter((b) => b.group === group);
      if (defs.length === 0) continue;
      el('h3', 'badge-group', this.list, t(`badges.groups.${group}`));
      const grid = el('div', 'badge-grid', this.list);
      for (const def of defs) this.renderRow(grid, def, data, records[def.id] ?? null);
    }
  }

  private renderRow(
    parent: HTMLElement,
    def: BadgeDef,
    data: Readonly<SaveData>,
    record: RecordBadge | null,
  ): void {
    const tiers = badgeTiers(def);
    const have = earnedTier(data.badges, def.id);
    const times = data.badges.earned[def.id] ?? [];
    const done = have >= tiers;
    const row = el('div', `ui-panel badge-row${have > 0 ? ' is-earned' : ''}`, parent);
    row.dataset.tier = String(tiers > 1 ? have : have > 0 ? 3 : 0);
    const medal = el('span', 'badge-medal', row);
    medal.setAttribute('aria-hidden', 'true');
    const body = el('div', 'badge-body', row);
    const head = el('div', 'badge-head', body);
    el('span', 'badge-name', head, badgeName(def.id));
    if (def.skill) el('span', 'badge-skill', head, t('badges.skill'));
    if (tiers > 1) {
      const pips = el('span', 'badge-pips', head);
      for (let k = 1; k <= tiers; k++)
        el('span', `badge-pip${k <= have ? ' is-on' : ''}`, pips).dataset.tier = String(k);
    }
    // 条件: 段階付きは次の段階（取り終えたら金の条件）
    const nextTier = Math.min(tiers, have + 1);
    const cond =
      tiers > 1
        ? `${badgeTierName(nextTier)}: ${badgeCondition(def.id, nextTier)}`
        : badgeCondition(def.id);
    el('div', 'badge-cond', body, cond);
    const meta = el('div', 'badge-meta', body);
    if (times.length > 0) {
      const dates = times.map((at, i) =>
        tiers > 1 ? `${badgeTierName(i + 1)} ${formatDate(at)}` : formatDate(at),
      );
      el('span', 'badge-date', meta, t('badges.earnedOn', { dates: dates.join(' · ') }));
    }
    if (!done) {
      const reward = def.rewards[have] ?? 0;
      el('span', 'badge-reward', meta, t('badges.reward', { credits: formatCredits(reward) }));
    }
    const progress = done ? null : record?.progress;
    if (progress) {
      const bar = el('div', 'badge-progress', body);
      const fill = el('span', 'badge-progress-fill', bar);
      fill.style.width = `${String(Math.round((progress.current / Math.max(1, progress.goal)) * 100))}%`;
      el(
        'span',
        'badge-progress-text',
        bar,
        t('badges.progress', { current: progress.current, goal: progress.goal }),
      );
    }
  }
}

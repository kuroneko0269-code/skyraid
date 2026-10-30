import './campaign.css';
import './save.css';
import type { Locale } from '../core/locale';
import type { MissionDef } from '../missions/types';
import type { CampaignProgress } from '../progression/campaign-progress';
import { el } from './hud-dom';
import { formatCredits, missionStrings } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

interface Entry {
  readonly mission: MissionDef;
  readonly button: HTMLButtonElement;
  readonly status: HTMLSpanElement;
}

/**
 * キャンペーンのミッション一覧（2-4。2-5 で 5 本）。並び順に表示し、前のミッションを成功するまで次は選べない。
 * クリア済みにはランクを出す。解放・ランクは CampaignProgress（3-1 からセーブに記録）。上部にクレジット残高（3-2）
 */
export class MissionSelectScreen {
  readonly root: HTMLDivElement;
  private readonly entries: Entry[] = [];
  private readonly balance: HTMLSpanElement;

  constructor(
    parent: HTMLElement,
    missions: readonly MissionDef[],
    private readonly progress: CampaignProgress,
    /** クレジット残高（表示のたびに読む） */
    private readonly credits: () => number,
    locale: Locale,
    handlers: { onSelect: (mission: MissionDef) => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen');
    el('h2', 'ui-heading campaign-heading', root, 'キャンペーン');
    const balance = el('div', 'campaign-balance', root);
    el('span', '', balance, '残高');
    this.balance = el('span', 'campaign-balance-value', balance);
    const list = el('div', 'mission-list', root);
    missions.forEach((m, i) => {
      const button = createButton(list, 'ui-button ui-item mission-entry', '', () => {
        if (this.progress.isUnlocked(m.id)) handlers.onSelect(m);
      });
      const head = el('span', 'mission-entry-head', button);
      el('span', 'mission-entry-no', head, `MISSION ${String(i + 1).padStart(2, '0')}`);
      const status = el('span', 'mission-entry-status', head);
      el('span', 'mission-entry-title', button, missionStrings(m.id, locale).title);
      this.entries.push({ mission: m, button, status });
    });
    createButton(root, 'ui-button is-ghost campaign-back', '← モード選択', handlers.onBack);
    this.root = root;
    this.refresh();
  }

  /** 残高・解放・ランクの表示をセーブに合わせる */
  refresh(): void {
    this.balance.textContent = formatCredits(this.credits());
    for (const { mission, button, status } of this.entries) {
      const unlocked = this.progress.isUnlocked(mission.id);
      const rank = this.progress.bestRank(mission.id);
      button.disabled = !unlocked;
      button.classList.toggle('is-locked', !unlocked);
      button.classList.toggle('is-cleared', rank !== null);
      status.textContent = rank !== null ? `CLEAR ${rank}` : unlocked ? '' : 'LOCKED';
    }
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) return;
    this.refresh();
    // 未クリアで選べる最初のミッション（なければ最後に選べるもの）にフォーカス
    const open = this.entries.filter((e) => !e.button.disabled);
    const next = open.find((e) => !this.progress.isCleared(e.mission.id)) ?? open[open.length - 1];
    next?.button.focus({ preventScroll: true });
  }
}

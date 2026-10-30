import './campaign.css';
import type { Locale } from '../core/locale';
import type { MissionDef } from '../missions/types';
import type { CampaignProgress } from '../progression/campaign-progress';
import { el } from './hud-dom';
import { missionStrings } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

interface Entry {
  readonly mission: MissionDef;
  readonly button: HTMLButtonElement;
  readonly status: HTMLSpanElement;
}

/**
 * キャンペーンのミッション一覧（2-4。2-5 で 5 本）。並び順に表示し、前のミッションを成功するまで次は選べない。
 * クリア済みにはランクを出す。解放・ランクは CampaignProgress（今はセッション内だけ）
 */
export class MissionSelectScreen {
  readonly root: HTMLDivElement;
  private readonly entries: Entry[] = [];

  constructor(
    parent: HTMLElement,
    missions: readonly MissionDef[],
    private readonly progress: CampaignProgress,
    locale: Locale,
    handlers: { onSelect: (mission: MissionDef) => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen');
    el('h2', 'campaign-heading', root, 'キャンペーン');
    const list = el('div', 'mission-list', root);
    missions.forEach((m, i) => {
      const button = createButton(list, 'menu-button mission-entry', '', () => {
        if (this.progress.isUnlocked(m.id)) handlers.onSelect(m);
      });
      const head = el('span', 'mission-entry-head', button);
      el('span', 'mission-entry-no', head, `MISSION ${String(i + 1).padStart(2, '0')}`);
      const status = el('span', 'mission-entry-status', head);
      el('span', 'mission-entry-title', button, missionStrings(m.id, locale).title);
      this.entries.push({ mission: m, button, status });
    });
    createButton(root, 'menu-button campaign-back', '← モード選択', handlers.onBack);
    this.root = root;
    this.refresh();
  }

  /** 解放とランクの表示を進み具合に合わせる */
  refresh(): void {
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

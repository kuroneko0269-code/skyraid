import { t } from '../core/i18n';
import './campaign.css';
import './save.css';
import type { MissionDef } from '../missions/types';
import type { CampaignProgress } from '../progression/campaign-progress';
import { el } from './hud-dom';
import { formatCredits, missionDifficultyText, missionStrings } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

interface Entry {
  readonly mission: MissionDef;
  readonly button: HTMLButtonElement;
  readonly status: HTMLSpanElement;
}

/**
 * キャンペーンのミッション一覧（2-4。2-5 で 5 本、9-7 で 8 本。背の低い画面は 2 列）。並び順に表示し、前のミッションを成功するまで次は選べない。
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
    handlers: { onSelect: (mission: MissionDef) => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen mission-select-screen');
    // 9-7: 見出しと残高の行（背の低い画面では 1 行に並べて、8 本の一覧を画面に収める。campaign.css）
    const top = el('div', 'campaign-top', root);
    el('h2', 'ui-heading campaign-heading', top, t('campaign.heading'));
    const balance = el('div', 'campaign-balance', top);
    el('span', '', balance, t('campaign.balance'));
    this.balance = el('span', 'campaign-balance-value', balance);
    const list = el('div', 'mission-list', root);
    // 9-7: 背の低い画面の 2 列（左に前半・右に後半）の行の数
    list.style.setProperty('--mission-rows', String(Math.ceil(missions.length / 2)));
    missions.forEach((m, i) => {
      const button = createButton(list, 'ui-button ui-item mission-entry', '', () => {
        if (this.progress.isUnlocked(m.id)) handlers.onSelect(m);
      });
      const head = el('span', 'mission-entry-head', button);
      el('span', 'mission-entry-no', head, `MISSION ${String(i + 1).padStart(2, '0')}`);
      // 難易度（4-12）。例「入門」「易〜普」
      const level = missionDifficultyText(m);
      if (level) el('span', 'mission-entry-level', head, level);
      const status = el('span', 'mission-entry-status', head);
      el('span', 'mission-entry-title', button, missionStrings(m.id).title);
      this.entries.push({ mission: m, button, status });
    });
    createButton(
      root,
      'ui-button is-ghost campaign-back',
      t('campaign.backToModes'),
      handlers.onBack,
    );
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
      status.classList.toggle('is-rank-s', rank === 'S');
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

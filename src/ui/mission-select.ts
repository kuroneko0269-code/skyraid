import './campaign.css';
import type { MissionDef } from '../missions/types';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';

/** キャンペーンのミッション一覧（2-4。今は 1 本。2-5 で増える） */
export class MissionSelectScreen {
  readonly root: HTMLDivElement;
  private first: HTMLButtonElement | null = null;

  constructor(
    parent: HTMLElement,
    missions: readonly MissionDef[],
    handlers: { onSelect: (mission: MissionDef) => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen');
    el('h2', 'campaign-heading', root, 'キャンペーン');
    const list = el('div', 'mission-list', root);
    missions.forEach((m, i) => {
      const button = createButton(list, 'menu-button mission-entry', '', () => {
        handlers.onSelect(m);
      });
      el('span', 'mission-entry-no', button, `MISSION ${String(i + 1).padStart(2, '0')}`);
      el('span', 'mission-entry-title', button, m.title);
      this.first ??= button;
    });
    createButton(root, 'menu-button campaign-back', '← モード選択', handlers.onBack);
    this.root = root;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.first?.focus({ preventScroll: true });
  }
}

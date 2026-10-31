// ロビーの「ハンガー」（5-4）: 所持している機体だけを並べ、選んだ機体で対戦に出る（強化はシングルの値。
// ホストが「強化を無効にする」なら全員 Lv 0）。購入・強化はできない（シングルのハンガーで）。文字は textContent だけで入れる
import type { AircraftStats } from '../data/aircraft';
import { el } from './hud-dom';
import { createButton } from './screen';

export interface LobbyHangarEntry {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly stats: AircraftStats;
  readonly selected: boolean;
}

const STAT_LABELS: readonly [keyof AircraftStats, string][] = [
  ['speed', '速度'],
  ['turn', '旋回'],
  ['durability', '耐久'],
  ['payload', '搭載'],
];

export class LobbyHangar {
  private readonly dialog: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLParagraphElement;

  constructor(
    parent: HTMLElement,
    private readonly onPick: (id: string) => void,
  ) {
    this.dialog = el('div', 'lobby-overlay', parent);
    this.dialog.hidden = true;
    const box = el('div', 'ui-dialog lobby-dialog lobby-hangar', this.dialog);
    el('div', 'ui-kicker', box, 'HANGAR');
    el('h3', 'ui-heading', box, '機体を選ぶ');
    this.note = el('p', 'briefing-text', box);
    this.list = el('div', 'lobby-hangar-list', box);
    const buttons = el('div', 'campaign-buttons', box);
    createButton(buttons, 'ui-button is-ghost campaign-back', '閉じる', () => {
      this.close();
    });
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.dialog.hidden;
  }

  /** 開く。note は強化の扱いの説明 */
  open(entries: readonly LobbyHangarEntry[], note: string): void {
    this.note.textContent = note;
    this.list.replaceChildren();
    for (const e of entries) {
      const item = createButton(this.list, 'ui-item lobby-hangar-item', '', () => {
        this.close();
        if (!e.selected) this.onPick(e.id);
      });
      item.classList.toggle('is-selected', e.selected);
      item.setAttribute('aria-pressed', String(e.selected));
      const head = el('span', 'lobby-hangar-head', item);
      el('span', 'lobby-hangar-name', head, e.name);
      el('span', 'tag', head, e.selected ? '選択中' : e.role);
      const stats = STAT_LABELS.map(([k, label]) => `${label} ×${e.stats[k].toFixed(2)}`);
      el('span', 'lobby-hangar-stats', item, stats.join('  '));
    }
    this.dialog.hidden = false;
    this.list.querySelector('button')?.focus({ preventScroll: true });
  }

  close(): void {
    this.dialog.hidden = true;
  }
}

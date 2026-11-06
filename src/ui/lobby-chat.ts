// ロビーの定型文（5-4 の定型文 6 種と 6-6 のレイドの 4 種）を選ぶ小さなダイアログ（9-10d: 部屋の画面の下の帯の「定型文」から開く）。
// 選ぶと送って閉じる。枠の外を押すか「閉じる」で閉じる。文字は textContent だけで入れる
import { PVP_QUICK_PHRASES, RAID_PHRASE_BASE } from '../data/pvp';
import { RAID_QUICK_PHRASES } from '../data/raid';
import type { GameSettings } from '../net/protocol';
import { t } from '../core/i18n';
import { el } from './hud-dom';
import { syncRaidChat } from './lobby-controls';
import { createButton } from './screen';
import { noteScreenSwitch } from './screen-switch';

export class LobbyChat {
  private readonly dialog: HTMLDivElement;
  private readonly raid: HTMLButtonElement[];
  private readonly first: HTMLButtonElement | null;

  constructor(parent: HTMLElement, onChat: (phrase: number) => void) {
    this.dialog = el('div', 'lobby-overlay', parent);
    this.dialog.hidden = true;
    const box = el('div', 'ui-dialog lobby-dialog lobby-chat-dialog', this.dialog);
    el('div', 'ui-kicker', box, t('lobby.room.chatTitle'));
    const grid = el('div', 'lobby-chat', box);
    const send = (i: number): void => {
      this.close();
      onChat(i);
    };
    const pvp = PVP_QUICK_PHRASES.map((text, i) =>
      createButton(grid, 'ui-button lobby-chat-button', text, () => {
        send(i);
      }),
    );
    // 6-6: レイドだけの定型文（レイドのときだけ出す）
    this.raid = RAID_QUICK_PHRASES.map((text, i) =>
      createButton(grid, 'ui-button lobby-chat-button', text, () => {
        send(RAID_PHRASE_BASE + i);
      }),
    );
    this.first = pvp[0] ?? null;
    const buttons = el('div', 'campaign-buttons', box);
    createButton(buttons, 'ui-button is-ghost campaign-back', t('lobby.close'), () => {
      this.close();
    });
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.close();
    });
  }

  /** レイドの定型文の出し分け（6-6・9-6c） */
  sync(st: Readonly<GameSettings>): void {
    syncRaidChat(this.raid, st);
  }

  get isOpen(): boolean {
    return !this.dialog.hidden;
  }

  open(): void {
    // 9-9b: 押したタップがダイアログのボタンへ押し抜けない
    noteScreenSwitch();
    this.dialog.hidden = false;
    this.first?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.dialog.hidden) return;
    this.dialog.hidden = true;
    noteScreenSwitch();
  }
}

import './mode-select.css';
import { createButton, createScreen, setScreenShown } from './screen';

export const GAME_MODES = ['free', 'campaign', 'hangar', 'pvp', 'raid'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** フリーフライトの説明（ポーズメニューの「敵」設定に合わせて書き換える） */
const FREE_FLIGHT_NOTES = { on: '敵機と空戦・自由に飛ぶ', off: '敵なしで自由に飛ぶ' } as const;

/** 表示するモード。enabled でないものは「近日」と出して選べない */
const MODE_ENTRIES: readonly { mode: GameMode; label: string; note: string; enabled: boolean }[] = [
  { mode: 'free', label: 'フリーフライト', note: FREE_FLIGHT_NOTES.on, enabled: true },
  { mode: 'campaign', label: 'キャンペーン', note: 'ミッションを順にクリア', enabled: true },
  { mode: 'hangar', label: 'ハンガー', note: '機体の購入・強化', enabled: true },
  { mode: 'pvp', label: 'PvP', note: '2〜4 人で空戦', enabled: false },
  { mode: 'raid', label: 'レイド', note: '巨大怪獣を協力撃破', enabled: false },
];

/** モード選択画面。今はフリーフライトとキャンペーン（2-4）とハンガー（3-3）を選べる */
export class ModeSelectScreen {
  readonly root: HTMLDivElement;
  private firstEnabled: HTMLButtonElement | null = null;
  private freeNote: HTMLSpanElement | null = null;

  constructor(
    parent: HTMLElement,
    handlers: { onSelect: (mode: GameMode) => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'mode-select-screen');
    const heading = document.createElement('h2');
    heading.className = 'ui-heading mode-heading';
    heading.textContent = 'モード選択';
    const list = document.createElement('div');
    list.className = 'mode-list';
    root.append(heading, list);

    for (const entry of MODE_ENTRIES) {
      const button = createButton(list, 'ui-button ui-item mode-button', '', () => {
        handlers.onSelect(entry.mode);
      });
      const label = document.createElement('span');
      label.className = 'mode-label';
      label.textContent = entry.label;
      const note = document.createElement('span');
      note.className = 'mode-note';
      note.textContent = entry.enabled ? entry.note : '近日';
      button.append(label, note);
      if (entry.mode === 'free') this.freeNote = note;
      button.disabled = !entry.enabled;
      if (entry.enabled) this.firstEnabled ??= button;
    }
    createButton(root, 'ui-button is-ghost mode-back', '← タイトルへ', handlers.onBack);
    this.root = root;
  }

  /** フリーフライトの説明を敵の設定（ON/OFF）に合わせる */
  setEnemiesEnabled(enabled: boolean): void {
    if (this.freeNote) this.freeNote.textContent = FREE_FLIGHT_NOTES[enabled ? 'on' : 'off'];
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    // キーボードでも Enter で始められるよう、選べる最初のモードにフォーカス
    if (shown) this.firstEnabled?.focus({ preventScroll: true });
  }
}

import './mode-select.css';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';
import type { TutorialStrings } from './tutorial-text';

export const GAME_MODES = ['tutorial', 'free', 'campaign', 'hangar', 'pvp', 'raid'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** フリーフライトの説明（ポーズメニューの「敵」設定に合わせて書き換える） */
const FREE_FLIGHT_NOTES = { on: '敵機と空戦・自由に飛ぶ', off: '敵なしで自由に飛ぶ' } as const;

/** 表示するモード。enabled でないものは「近日」と出して選べない */
const MODE_ENTRIES: readonly { mode: GameMode; label: string; note: string; enabled: boolean }[] = [
  // チュートリアル（4-11）の文は i18n（コンストラクタで差し替える）
  { mode: 'tutorial', label: '', note: '', enabled: true },
  { mode: 'free', label: 'フリーフライト', note: FREE_FLIGHT_NOTES.on, enabled: true },
  { mode: 'campaign', label: 'キャンペーン', note: 'ミッションを順にクリア', enabled: true },
  { mode: 'hangar', label: 'ハンガー', note: '機体の購入・強化', enabled: true },
  // PvP（5-1）: 今は同じ空を飛ぶまで（撃ち合いは 5-3）
  { mode: 'pvp', label: 'PvP', note: '2〜4 人で同じ空を飛ぶ', enabled: true },
  { mode: 'raid', label: 'レイド', note: '巨大怪獣を協力撃破', enabled: false },
];

/**
 * モード選択画面。チュートリアル（4-11）・フリーフライトとキャンペーン（2-4）・ハンガー（3-3）・PvP（5-1）を選べる。
 * 初回起動（パイロット名の入力の後）に 1 度だけ「チュートリアルを始めますか？」を重ねて出す
 */
export class ModeSelectScreen {
  readonly root: HTMLDivElement;
  private firstEnabled: HTMLButtonElement | null = null;
  private freeNote: HTMLSpanElement | null = null;
  private readonly prompt: HTMLDivElement;
  private readonly promptStart: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    tutorial: TutorialStrings,
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
      const tut = entry.mode === 'tutorial';
      label.textContent = tut ? tutorial.title : entry.label;
      const note = document.createElement('span');
      note.className = 'mode-note';
      note.textContent = tut ? tutorial.note : entry.enabled ? entry.note : '近日';
      button.append(label, note);
      if (entry.mode === 'free') this.freeNote = note;
      button.disabled = !entry.enabled;
      if (entry.enabled) this.firstEnabled ??= button;
    }
    createButton(root, 'ui-button is-ghost mode-back', '← タイトルへ', handlers.onBack);
    // 初回のチュートリアルの案内（4-11）
    this.prompt = el('div', 'mode-prompt', root);
    this.prompt.hidden = true;
    const box = el('div', 'ui-dialog mode-prompt-box', this.prompt);
    el('h3', 'ui-heading mode-prompt-title', box, tutorial.prompt);
    el('p', 'mode-prompt-text', box, tutorial.promptBody);
    const buttons = el('div', 'campaign-buttons', box);
    createButton(buttons, 'ui-button is-ghost campaign-back', tutorial.later, () => {
      this.closeDialog();
      this.firstEnabled?.focus({ preventScroll: true });
    });
    this.promptStart = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      tutorial.start,
      () => {
        this.closeDialog();
        handlers.onSelect('tutorial');
      },
    );
    this.root = root;
  }

  /** 「チュートリアルを始めますか？」を出す */
  showTutorialPrompt(): void {
    this.prompt.hidden = false;
    this.promptStart.focus({ preventScroll: true });
  }

  /** 案内が開いていれば閉じて true（Esc） */
  closeDialog(): boolean {
    if (this.prompt.hidden) return false;
    this.prompt.hidden = true;
    return true;
  }

  /** フリーフライトの説明を敵の設定（ON/OFF）に合わせる */
  setEnemiesEnabled(enabled: boolean): void {
    if (this.freeNote) this.freeNote.textContent = FREE_FLIGHT_NOTES[enabled ? 'on' : 'off'];
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) this.closeDialog();
    // キーボードでも Enter で始められるよう、選べる最初のモードにフォーカス
    if (shown) this.firstEnabled?.focus({ preventScroll: true });
  }
}

import type { RaidDifficulty } from '../data/raid';
import type { DefenseDifficulty } from '../data/defense';
import './mode-select.css';
import { ModeDialogs } from './mode-dialogs';
import { createButton, createScreen, setScreenShown } from './screen';
import type { TutorialStrings } from './tutorial-text';

export const GAME_MODES = [
  'tutorial',
  'free',
  'campaign',
  'race',
  'defense',
  'hangar',
  'pvp',
  'raid',
  'replay',
] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** フリーフライトの説明（ポーズメニューの「敵」設定に合わせて書き換える） */
const FREE_FLIGHT_NOTES = { on: '敵機と空戦・自由に飛ぶ', off: '敵なしで自由に飛ぶ' } as const;

/** 表示するモード。enabled でないものは「近日」と出して選べない */
const MODE_ENTRIES: readonly { mode: GameMode; label: string; note: string; enabled: boolean }[] = [
  // チュートリアル（4-11）の文は i18n（コンストラクタで差し替える）
  { mode: 'tutorial', label: '', note: '', enabled: true },
  { mode: 'free', label: 'フリーフライト', note: FREE_FLIGHT_NOTES.on, enabled: true },
  { mode: 'campaign', label: 'キャンペーン', note: 'ミッションを順にクリア', enabled: true },
  // リングレース（7-1）: ソロのタイムアタック（マルチは後日）
  { mode: 'race', label: 'リングレース', note: 'リングを抜けるタイムアタック', enabled: true },
  // 防衛戦（7-2）: ソロはすぐ出撃、協力は PvP のロビーを使う
  { mode: 'defense', label: '防衛戦', note: '基地を 10 波の敵から守る（1〜4 人）', enabled: true },
  { mode: 'hangar', label: 'ハンガー', note: '機体の購入・強化', enabled: true },
  // PvP（5-1）: 今は同じ空を飛ぶまで（撃ち合いは 5-3）
  { mode: 'pvp', label: 'PvP', note: '2〜4 人で同じ空を飛ぶ', enabled: true },
  // レイド（6-2）: ソロはすぐ出撃、協力は PvP のロビーを使う
  { mode: 'raid', label: 'レイド', note: '巨大怪獣ヴォルガスを撃破（1〜4 人）', enabled: true },
  // リプレイ（7-B）: シングルプレイの記録の一覧と再生
  { mode: 'replay', label: 'リプレイ', note: '直近 10 本と保存した記録を見る', enabled: true },
];

/**
 * モード選択画面。チュートリアル（4-11）・フリーフライトとキャンペーン（2-4）・リングレース（7-1）・ハンガー（3-3）・PvP（5-1）・レイド（6-2）を選べる。
 * 初回起動（パイロット名の入力の後）に 1 度だけ「チュートリアルを始めますか？」を重ねて出す。重ねるダイアログは mode-dialogs.ts
 */
export class ModeSelectScreen {
  readonly root: HTMLDivElement;
  private firstEnabled: HTMLButtonElement | null = null;
  private freeNote: HTMLSpanElement | null = null;
  private readonly dialogs: ModeDialogs;

  constructor(
    parent: HTMLElement,
    tutorial: TutorialStrings,
    handlers: {
      onSelect: (mode: GameMode) => void;
      onBack: () => void;
      /** レイドの人数を選んだ（6-2）: solo はすぐ出撃、coop は PvP のロビーへ */
      /** difficulty はソロの難易度（6-6。協力はロビーでホストが選ぶ） */
      onRaid: (kind: 'solo' | 'coop', difficulty: RaidDifficulty) => void;
      /** 防衛戦（7-2）: solo はすぐ出撃、coop は PvP のロビーへ（マップと難易度はホストの初期設定） */
      onDefense: (kind: 'solo' | 'coop', mapId: string, difficulty: DefenseDifficulty) => void;
    },
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
        // 6-4: フリーフライトはマップを選んでから
        if (entry.mode === 'free') this.showMapPrompt();
        else handlers.onSelect(entry.mode);
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
    this.dialogs = new ModeDialogs(root, tutorial, {
      onStart: (mode) => {
        handlers.onSelect(mode);
      },
      onRaid: handlers.onRaid,
      onDefense: handlers.onDefense,
      onClose: () => this.firstEnabled?.focus({ preventScroll: true }),
    });
    this.root = root;
  }

  /** フリーフライトのマップ（6-4）・天候（7-5）・「時間が流れる」。URL の指定（?map= など）で書き換える */
  get freeMapId(): string {
    return this.dialogs.freeMapId;
  }
  set freeMapId(v: string) {
    this.dialogs.freeMapId = v;
  }
  get freeWeatherId(): string {
    return this.dialogs.freeWeatherId;
  }
  set freeWeatherId(v: string) {
    this.dialogs.freeWeatherId = v;
  }
  get freeTimeFlow(): boolean {
    return this.dialogs.freeTimeFlow;
  }
  set freeTimeFlow(v: boolean) {
    this.dialogs.freeTimeFlow = v;
  }
  /** 防衛戦（7-2）のマップと難易度（選ぶたびに変わる） */
  get defenseMapId(): string {
    return this.dialogs.defenseMapId;
  }
  get defenseDifficulty(): DefenseDifficulty {
    return this.dialogs.defenseDifficulty;
  }

  /** フリーフライトのマップ・天候の選択を出す（6-4） */
  showMapPrompt(): void {
    this.dialogs.showFree();
  }

  /** レイドの人数・難易度の選択を出す（6-2） */
  showRaidPrompt(): void {
    this.dialogs.showRaid();
  }

  /** 防衛戦の人数・マップ・難易度の選択を出す（7-2） */
  showDefensePrompt(): void {
    this.dialogs.showDefense();
  }

  /** 「チュートリアルを始めますか？」を出す */
  showTutorialPrompt(): void {
    this.dialogs.showTutorial();
  }

  /** 案内が開いていれば閉じて true（Esc） */
  closeDialog(): boolean {
    return this.dialogs.close();
  }

  /** フリーフライトの説明を敵の設定（ON/OFF）に合わせる */
  setEnemiesEnabled(enabled: boolean): void {
    if (this.freeNote) this.freeNote.textContent = FREE_FLIGHT_NOTES[enabled ? 'on' : 'off'];
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) this.closeDialog();
    // キーボードでも Enter で始められるよう、選べる最初のモードにフォーカス（タッチでは枠を出さない。tap-focus.ts）
    if (shown) this.firstEnabled?.focus({ preventScroll: true });
  }
}

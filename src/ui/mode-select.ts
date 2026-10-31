import type { RaidDifficulty } from '../data/raid';
import './mode-select.css';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';
import type { TutorialStrings } from './tutorial-text';
import { SELECTABLE_MAPS, ISLAND_MAP } from '../data/maps';
import { DEFAULT_WEATHER_ID, WEATHER_PRESETS, weatherLabel } from '../data/weather';

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
  // レイド（6-2）: ソロはすぐ出撃、協力は PvP のロビーを使う
  { mode: 'raid', label: 'レイド', note: '巨大怪獣ヴォルガスを撃破（1〜4 人）', enabled: true },
];

/**
 * モード選択画面。チュートリアル（4-11）・フリーフライトとキャンペーン（2-4）・ハンガー（3-3）・PvP（5-1）・レイド（6-2）を選べる。
 * 初回起動（パイロット名の入力の後）に 1 度だけ「チュートリアルを始めますか？」を重ねて出す
 */
export class ModeSelectScreen {
  readonly root: HTMLDivElement;
  private firstEnabled: HTMLButtonElement | null = null;
  private freeNote: HTMLSpanElement | null = null;
  private readonly prompt: HTMLDivElement;
  private readonly promptStart: HTMLButtonElement;
  private readonly raidPrompt: HTMLDivElement;
  private readonly raidSolo: HTMLButtonElement;
  private readonly mapPrompt: HTMLDivElement;
  private readonly mapButtons: HTMLButtonElement[] = [];
  /** フリーフライトのマップ（6-4。選ぶたびに変わる。初めは島） */
  freeMapId: string = ISLAND_MAP.id;
  /** フリーフライトの天候（7-5。初めは昼・快晴）と「時間が流れる」 */
  freeWeatherId: string = DEFAULT_WEATHER_ID;
  freeTimeFlow = false;
  private weatherSelect: HTMLSelectElement | null = null;

  constructor(
    parent: HTMLElement,
    tutorial: TutorialStrings,
    handlers: {
      onSelect: (mode: GameMode) => void;
      onBack: () => void;
      /** レイドの人数を選んだ（6-2）: solo はすぐ出撃、coop は PvP のロビーへ */
      /** difficulty はソロの難易度（6-6。協力はロビーでホストが選ぶ） */
      onRaid: (kind: 'solo' | 'coop', difficulty: RaidDifficulty) => void;
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
    // レイドの人数の選択（6-2）
    this.raidPrompt = el('div', 'mode-prompt', root);
    this.raidPrompt.hidden = true;
    const raidBox = el('div', 'ui-dialog mode-prompt-box', this.raidPrompt);
    el('h3', 'ui-heading mode-prompt-title', raidBox, 'レイド：ヴォルガス');
    el(
      'p',
      'mode-prompt-text',
      raidBox,
      '1 人は難易度を選んですぐ出撃（高難度は HP ×1.4・予兆が短い・最終フェーズ 3.5 分・報酬 ×1.8）。2〜4 人は部屋を作るか、部屋コードで参加します（全員が同じチーム。難易度はホストが選ぶ）。',
    );
    const raidButtons = el('div', 'campaign-buttons', raidBox);
    createButton(raidButtons, 'ui-button is-ghost campaign-back', '戻る', () => {
      this.closeDialog();
      this.firstEnabled?.focus({ preventScroll: true });
    });
    createButton(raidButtons, 'ui-button campaign-go', '協力（2〜4 人）', () => {
      this.closeDialog();
      handlers.onRaid('coop', 'normal');
    });
    // 6-6: ソロは開始前に難易度を選ぶ（高難度: HP ×1.4・予兆 −0.5 秒・最終フェーズ 3.5 分・報酬 ×1.8）
    createButton(raidButtons, 'ui-button campaign-go', 'ソロ・高難度', () => {
      this.closeDialog();
      handlers.onRaid('solo', 'hard');
    });
    this.raidSolo = createButton(
      raidButtons,
      'ui-button is-primary campaign-go',
      'ソロ・通常',
      () => {
        this.closeDialog();
        handlers.onRaid('solo', 'normal');
      },
    );
    // フリーフライトのマップの選択（6-4）
    this.mapPrompt = el('div', 'mode-prompt', root);
    this.mapPrompt.hidden = true;
    const mapBox = el('div', 'ui-dialog mode-prompt-box', this.mapPrompt);
    el('h3', 'ui-heading mode-prompt-title', mapBox, 'フリーフライト：マップ');
    this.createWeatherRow(mapBox);
    const mapList = el('div', 'campaign-buttons', mapBox);
    createButton(mapList, 'ui-button is-ghost campaign-back', '戻る', () => {
      this.closeDialog();
      this.firstEnabled?.focus({ preventScroll: true });
    });
    for (const map of SELECTABLE_MAPS) {
      const b = createButton(mapList, 'ui-button campaign-go', map.name, () => {
        this.freeMapId = map.id;
        this.closeDialog();
        handlers.onSelect('free');
      });
      b.dataset.map = map.id;
      this.mapButtons.push(b);
    }
    this.root = root;
  }

  /** フリーフライトの天候（7-5）: プリセットの選択と「時間が流れる」（フリーフライトだけ） */
  private createWeatherRow(parent: HTMLElement): void {
    const row = el('div', 'mode-weather', parent);
    const label = el('label', 'campaign-fact mode-weather-item', row);
    el('span', 'campaign-fact-label', label, '天候');
    const select = el('select', 'ui-field mode-weather-select', label);
    for (const w of WEATHER_PRESETS) {
      const o = el('option', '', select, weatherLabel(w.id));
      o.value = w.id;
    }
    select.value = this.freeWeatherId;
    select.addEventListener('change', () => {
      this.freeWeatherId = select.value;
    });
    this.weatherSelect = select;
    const flow = createButton(row, 'ui-toggle mode-weather-item', '', () => {
      this.freeTimeFlow = !this.freeTimeFlow;
      sync();
    });
    const sync = (): void => {
      flow.textContent = `時間が流れる ${this.freeTimeFlow ? 'ON' : 'OFF'}`;
      flow.setAttribute('aria-pressed', String(this.freeTimeFlow));
    };
    sync();
  }

  /** フリーフライトのマップの選択を出す（6-4。前に選んだマップにフォーカス） */
  showMapPrompt(): void {
    this.mapPrompt.hidden = false;
    if (this.weatherSelect) this.weatherSelect.value = this.freeWeatherId;
    const b = this.mapButtons.find((x) => x.dataset.map === this.freeMapId) ?? this.mapButtons[0];
    b?.focus({ preventScroll: true });
  }

  /** レイドの人数の選択を出す（6-2） */
  showRaidPrompt(): void {
    this.raidPrompt.hidden = false;
    this.raidSolo.focus({ preventScroll: true });
  }

  /** 「チュートリアルを始めますか？」を出す */
  showTutorialPrompt(): void {
    this.prompt.hidden = false;
    this.promptStart.focus({ preventScroll: true });
  }

  /** 案内が開いていれば閉じて true（Esc） */
  closeDialog(): boolean {
    if (this.prompt.hidden && this.raidPrompt.hidden && this.mapPrompt.hidden) return false;
    this.prompt.hidden = true;
    this.raidPrompt.hidden = true;
    this.mapPrompt.hidden = true;
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

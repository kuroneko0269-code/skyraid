import { t } from '../core/i18n';
import type { RaidDifficulty } from '../data/raid';
import type { DefenseDifficulty } from '../data/defense';
import './mode-select.css';
import { createGlyph, type GlyphKind } from './glyphs';
import { el } from './hud-dom';
import { ModeDialogs } from './mode-dialogs';
import { createButton, createScreen, setScreenShown } from './screen';
import type { TutorialStrings } from './tutorial-text';

export const GAME_MODES = [
  'tutorial',
  'free',
  'campaign',
  'practice',
  'race',
  'defense',
  'hangar',
  'pvp',
  'raid',
  'replay',
  'ranking',
  'settings',
  'info',
] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** フリーフライトの説明（設定の「敵」に合わせて書き換える）。表のキー modes.free.* */
const FREE_FLIGHT_NOTE_KEYS = { on: 'modes.free.noteOn', off: 'modes.free.noteOff' } as const;

/** 人数のバッジ（solo はソロ、versus は 2〜4 人、party は 1〜4 人）。表のキー modes.players.* */
type PlayersBadge = 'solo' | 'versus' | 'party';

interface PlayEntry {
  readonly mode: GameMode;
  /** 人数のバッジ */
  readonly players: PlayersBadge;
  readonly glyph: GlyphKind;
}

/**
 * 上段「遊ぶ」（7-D）。大きなカードに人数のバッジと進捗。説明の人数（1〜4 人など）はバッジに移した。
 * 題と説明は表のキー modes.<mode>.label / note。チュートリアル（4-11）の文は tutorial-text（コンストラクタで差し替える）。
 * リングレース（7-1）は今はソロだけ
 */
const PLAY_ENTRIES: readonly PlayEntry[] = [
  { mode: 'tutorial', players: 'solo', glyph: 'fighter' },
  { mode: 'campaign', players: 'solo', glyph: 'star' },
  { mode: 'free', players: 'solo', glyph: 'cloudWing' },
  // 9-5: 練習場（課題 3 つ・結果の指標と助言・設定ごとの記録）
  { mode: 'practice', players: 'solo', glyph: 'target' },
  { mode: 'race', players: 'solo', glyph: 'ring' },
  { mode: 'pvp', players: 'versus', glyph: 'crossedJets' },
  { mode: 'raid', players: 'party', glyph: 'kaiju' },
  { mode: 'defense', players: 'party', glyph: 'radar' },
];

/** 下段「管理」（7-D）。小さなタイル 1 行。ランキング（7-4）はオンライン連携の連携中だけ（setModeVisible）。題は modes.<mode>.label */
const MANAGE_ENTRIES: readonly { mode: GameMode; glyph: GlyphKind }[] = [
  { mode: 'hangar', glyph: 'hangar' },
  { mode: 'replay', glyph: 'play' },
  { mode: 'ranking', glyph: 'trophy' },
  { mode: 'settings', glyph: 'gear' },
  { mode: 'info', glyph: 'info' },
];

/** 初めは隠すモード（ランキングはオンライン連携の状態で出す） */
const INITIALLY_HIDDEN: readonly GameMode[] = ['ranking'];

/**
 * モード選択画面（7-D で 2 段に）。上段「遊ぶ」8 枚のカード（9-5 で練習場）、下段「管理」のタイル。各カード・タイルの右下に線画のグリフ。
 * 初回起動（パイロット名の入力の後）に 1 度だけ「チュートリアルを始めますか？」を重ねて出す。重ねるダイアログは mode-dialogs.ts
 */
export class ModeSelectScreen {
  readonly root: HTMLDivElement;
  private firstEnabled: HTMLButtonElement | null = null;
  private freeNote: HTMLSpanElement | null = null;
  private readonly dialogs: ModeDialogs;
  private readonly buttons = new Map<GameMode, HTMLButtonElement>();
  private readonly progressLines = new Map<GameMode, HTMLSpanElement>();
  /** モード選択の上に重ねた画面（7-4: ランキング、7-D: 情報）。Esc で閉じる。閉じたら true を返す */
  private readonly overlays: (() => boolean)[] = [];
  /** カードの進捗（7-D。出すたびに読む。Screens が差し込む） */
  progress: () => Partial<Record<GameMode, string>> = () => ({});

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
    const header = el('div', 'menu-header', root);
    createButton(header, 'ui-button is-ghost menu-back', t('modes.backToTitle'), handlers.onBack);
    el('h2', 'ui-heading menu-heading', header, t('modes.heading'));

    const select = (mode: GameMode): void => {
      // 6-4: フリーフライトはマップを選んでから
      if (mode === 'free') this.showMapPrompt();
      else handlers.onSelect(mode);
    };

    el('div', 'ui-kicker mode-section', root, t('modes.play'));
    const play = el('div', 'mode-play', root);
    for (const entry of PLAY_ENTRIES) {
      const tut = entry.mode === 'tutorial';
      const card = this.addButton(play, 'mode-card', entry.mode, entry.glyph, select);
      el('span', 'mode-label', card, tut ? tutorial.title : t(`modes.${entry.mode}.label`));
      const noteText = tut
        ? tutorial.note
        : t(entry.mode === 'free' ? FREE_FLIGHT_NOTE_KEYS.on : `modes.${entry.mode}.note`);
      const note = el('span', 'mode-note', card, noteText);
      if (entry.mode === 'free') this.freeNote = note;
      // 下の行: 左に進捗、右に人数のバッジ（題の行を広く使う）
      const foot = el('span', 'mode-card-foot', card);
      this.progressLines.set(entry.mode, el('span', 'mode-progress', foot));
      const multi = entry.players !== 'solo';
      el(
        'span',
        `mode-badge${multi ? ' is-multi' : ''}`,
        foot,
        t(`modes.players.${entry.players}`),
      );
    }

    el('div', 'ui-kicker mode-section', root, t('modes.manage'));
    const manage = el('div', 'mode-manage', root);
    for (const entry of MANAGE_ENTRIES) {
      const tile = this.addButton(manage, 'mode-tile', entry.mode, entry.glyph, select);
      el('span', 'mode-label', tile, t(`modes.${entry.mode}.label`));
    }

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

  private addButton(
    parent: HTMLElement,
    cls: string,
    mode: GameMode,
    glyph: GlyphKind,
    select: (mode: GameMode) => void,
  ): HTMLButtonElement {
    const b = createButton(parent, `ui-button ui-item ${cls}`, '', () => {
      select(mode);
    });
    b.dataset.mode = mode;
    b.appendChild(createGlyph(glyph, 'mode-glyph'));
    b.hidden = INITIALLY_HIDDEN.includes(mode);
    this.buttons.set(mode, b);
    this.firstEnabled ??= b;
    return b;
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

  /** 案内（と重ねた画面）が開いていれば閉じて true（Esc） */
  closeDialog(): boolean {
    if (this.dialogs.close()) return true;
    return this.overlays.some((close) => close());
  }

  /** モードのボタンを出す・隠す（7-4: ランキング） */
  setModeVisible(mode: GameMode, visible: boolean): void {
    const b = this.buttons.get(mode);
    if (b) b.hidden = !visible;
  }

  /** モード選択の上に重ねる画面の「閉じる」を登録する（7-4） */
  addOverlay(close: () => boolean): void {
    this.overlays.push(close);
  }

  /** フリーフライトの説明を敵の設定（ON/OFF）に合わせる */
  setEnemiesEnabled(enabled: boolean): void {
    if (this.freeNote) this.freeNote.textContent = t(FREE_FLIGHT_NOTE_KEYS[enabled ? 'on' : 'off']);
  }

  setShown(shown: boolean): void {
    if (shown) this.refreshProgress();
    setScreenShown(this.root, shown);
    if (!shown) this.closeDialog();
    // キーボードでも Enter で始められるよう、選べる最初のモードにフォーカス（タッチでは枠を出さない。tap-focus.ts）
    if (shown) this.firstEnabled?.focus({ preventScroll: true });
  }

  /** 重ねた画面（ランキング・情報・設定）から戻ったとき: ダイアログを閉じずに出し直す */
  reveal(): void {
    this.refreshProgress();
    setScreenShown(this.root, true);
    this.firstEnabled?.focus({ preventScroll: true });
  }

  private refreshProgress(): void {
    const p = this.progress();
    for (const [mode, line] of this.progressLines) {
      const text = p[mode] ?? '';
      line.textContent = text;
      line.hidden = text === '';
    }
  }
}

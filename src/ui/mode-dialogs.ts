// モード選択の上に重ねるダイアログ（7-C で mode-select.ts から分けた）: チュートリアルの案内（4-11）・
// フリーフライトのマップと天候（6-4・7-5）・レイドの人数と難易度（6-2・6-6）・防衛戦の人数・マップ・難易度（7-2）。
// 選択はセグメント（ui/segmented.ts。高さ 48px 以上・選択中は塗りつぶし）、決定は下のボタン
import { DEFENSE_MAPS, type DefenseDifficulty } from '../data/defense';
import { ISLAND_MAP, SELECTABLE_MAPS } from '../data/maps';
import { RAID_DIFFICULTY_LABELS, type RaidDifficulty } from '../data/raid';
import { DEFAULT_WEATHER_ID, WEATHER_PRESETS, weatherLabel } from '../data/weather';
import { el } from './hud-dom';
import { createButton } from './screen';
import { Segmented } from './segmented';
import type { TutorialStrings } from './tutorial-text';

export interface ModeDialogHandlers {
  /** チュートリアルを始める・フリーフライトに出る */
  readonly onStart: (mode: 'tutorial' | 'free') => void;
  /** solo はすぐ出撃、coop は PvP のロビーへ（difficulty はソロの難易度。協力はロビーでホストが選ぶ） */
  readonly onRaid: (kind: 'solo' | 'coop', difficulty: RaidDifficulty) => void;
  /** solo はすぐ出撃、coop は PvP のロビーへ（マップと難易度はホストの初期設定） */
  readonly onDefense: (kind: 'solo' | 'coop', mapId: string, difficulty: DefenseDifficulty) => void;
  /** 閉じた（「戻る」「あとで」）。モードの一覧にフォーカスを戻す */
  readonly onClose: () => void;
}

const DIFFICULTY_OPTIONS = [
  { value: 'normal', label: RAID_DIFFICULTY_LABELS.normal },
  { value: 'hard', label: RAID_DIFFICULTY_LABELS.hard },
] as const;

const asDifficulty = (v: string): 'normal' | 'hard' => (v === 'hard' ? 'hard' : 'normal');

export class ModeDialogs {
  /** フリーフライトのマップ（6-4。初めは島）・天候（7-5。初めは昼・快晴）・「時間が流れる」 */
  freeMapId: string = ISLAND_MAP.id;
  freeWeatherId: string = DEFAULT_WEATHER_ID;
  freeTimeFlow = false;
  /** 防衛戦（7-2）のマップと難易度 */
  defenseMapId: string = DEFENSE_MAPS[0]?.mapId ?? 'island';
  defenseDifficulty: DefenseDifficulty = 'normal';
  raidDifficulty: RaidDifficulty = 'normal';

  private readonly all: HTMLDivElement[] = [];
  private readonly tutorialWrap: HTMLDivElement;
  private readonly tutorialStart: HTMLButtonElement;
  private readonly freeWrap: HTMLDivElement;
  private readonly freeGo: HTMLButtonElement;
  private readonly freeMap: Segmented;
  private readonly freeWeather: Segmented;
  private readonly freeTime: Segmented;
  private readonly raidWrap: HTMLDivElement;
  private readonly raidSolo: HTMLButtonElement;
  private readonly raidDiff: Segmented;
  private readonly defenseWrap: HTMLDivElement;
  private readonly defenseSolo: HTMLButtonElement;
  private readonly defenseMap: Segmented;
  private readonly defenseDiff: Segmented;

  constructor(root: HTMLElement, tutorial: TutorialStrings, h: ModeDialogHandlers) {
    const back = (parent: HTMLElement, label = '戻る'): void => {
      createButton(parent, 'ui-button is-ghost campaign-back', label, () => {
        this.close();
        h.onClose();
      });
    };
    const go = (parent: HTMLElement, label: string, primary: boolean, fn: () => void) =>
      createButton(parent, `ui-button campaign-go${primary ? ' is-primary' : ''}`, label, () => {
        this.close();
        fn();
      });

    // 初回のチュートリアルの案内（4-11）
    let box: HTMLDivElement;
    [this.tutorialWrap, box] = this.dialog(root, tutorial.prompt, tutorial.promptBody);
    let buttons = el('div', 'campaign-buttons', box);
    back(buttons, tutorial.later);
    this.tutorialStart = go(buttons, tutorial.start, true, () => {
      h.onStart('tutorial');
    });

    // フリーフライト: マップ・天候・時間
    [this.freeWrap, box] = this.dialog(root, 'フリーフライト');
    box.classList.add('mode-prompt-wide');
    this.freeMap = new Segmented(
      box,
      'マップ',
      SELECTABLE_MAPS.map((m) => ({ value: m.id, label: m.name })),
      this.freeMapId,
      (v) => (this.freeMapId = v),
    );
    this.freeWeather = new Segmented(
      box,
      '天候',
      WEATHER_PRESETS.map((w) => ({ value: w.id, label: weatherLabel(w.id) })),
      this.freeWeatherId,
      (v) => (this.freeWeatherId = v),
      'mode-seg-weather',
    );
    this.freeTime = new Segmented(
      box,
      '時間',
      [
        { value: 'fixed', label: '止める' },
        { value: 'flow', label: '流れる' },
      ],
      'fixed',
      (v) => (this.freeTimeFlow = v === 'flow'),
    );
    buttons = el('div', 'campaign-buttons', box);
    back(buttons);
    this.freeGo = go(buttons, '出撃', true, () => {
      h.onStart('free');
    });

    // レイド（6-2・6-6）: 高難度は HP ×1.4・予兆 −0.5 秒・最終フェーズ 3.5 分・報酬 ×1.8
    [this.raidWrap, box] = this.dialog(
      root,
      'レイド：ヴォルガス',
      '1 人は難易度を選んですぐ出撃（高難度は HP ×1.4・予兆が短い・最終フェーズ 3.5 分・報酬 ×1.8）。2〜4 人は部屋を作るか、部屋コードで参加します（全員が同じチーム。難易度はホストが選ぶ）。',
    );
    this.raidDiff = new Segmented(
      box,
      '難易度（ソロ）',
      DIFFICULTY_OPTIONS,
      this.raidDifficulty,
      (v) => (this.raidDifficulty = asDifficulty(v)),
    );
    buttons = el('div', 'campaign-buttons', box);
    back(buttons);
    go(buttons, '協力 2〜4人', false, () => {
      h.onRaid('coop', 'normal');
    });
    this.raidSolo = go(buttons, 'ソロで出撃', true, () => {
      h.onRaid('solo', this.raidDifficulty);
    });

    // 防衛戦（7-2）
    [this.defenseWrap, box] = this.dialog(
      root,
      '防衛戦',
      '基地の司令部を全 10 波の敵から守ります。波の間に基地の上を低く遅く（高度 300m 以下・速度 150 以下）通ると補給。高難度は敵 ×1.3・司令部 HP 1500。2〜4 人は部屋を作るか、部屋コードで参加します（全員が同じチーム）。',
    );
    this.defenseMap = new Segmented(
      box,
      'マップ',
      DEFENSE_MAPS.map((m) => ({ value: m.mapId, label: m.name })),
      this.defenseMapId,
      (v) => (this.defenseMapId = v),
    );
    this.defenseDiff = new Segmented(
      box,
      '難易度',
      DIFFICULTY_OPTIONS,
      this.defenseDifficulty,
      (v) => (this.defenseDifficulty = asDifficulty(v)),
    );
    buttons = el('div', 'campaign-buttons', box);
    back(buttons);
    go(buttons, '協力 2〜4人', false, () => {
      h.onDefense('coop', this.defenseMapId, this.defenseDifficulty);
    });
    this.defenseSolo = go(buttons, 'ソロで出撃', true, () => {
      h.onDefense('solo', this.defenseMapId, this.defenseDifficulty);
    });
  }

  showTutorial(): void {
    this.open(this.tutorialWrap, this.tutorialStart);
  }

  /** フリーフライト（6-4。前に選んだマップ・天候のまま） */
  showFree(): void {
    this.freeMap.value = this.freeMapId;
    this.freeWeather.value = this.freeWeatherId;
    this.freeTime.value = this.freeTimeFlow ? 'flow' : 'fixed';
    this.open(this.freeWrap, this.freeGo);
  }

  showRaid(): void {
    this.raidDiff.value = this.raidDifficulty;
    this.open(this.raidWrap, this.raidSolo);
  }

  showDefense(): void {
    this.defenseMap.value = this.defenseMapId;
    this.defenseDiff.value = this.defenseDifficulty;
    this.open(this.defenseWrap, this.defenseSolo);
  }

  /** 開いていれば閉じて true（Esc） */
  close(): boolean {
    if (this.all.every((d) => d.hidden)) return false;
    for (const d of this.all) d.hidden = true;
    return true;
  }

  private open(wrap: HTMLDivElement, focus: HTMLButtonElement): void {
    this.close();
    wrap.hidden = false;
    wrap.scrollTop = 0;
    // キーボードで Enter を押せば決まるように（タッチではフォーカスの枠を出さない。tap-focus.ts）
    focus.focus({ preventScroll: true });
  }

  private dialog(root: HTMLElement, title: string, text = ''): [HTMLDivElement, HTMLDivElement] {
    const wrap = el('div', 'mode-prompt', root);
    wrap.hidden = true;
    const box = el('div', 'ui-dialog mode-prompt-box', wrap);
    el('h3', 'ui-heading mode-prompt-title', box, title);
    if (text) el('p', 'mode-prompt-text', box, text);
    this.all.push(wrap);
    return [wrap, box];
  }
}

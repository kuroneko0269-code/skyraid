// モード選択の上に重ねるダイアログ（7-C で mode-select.ts から分けた）: チュートリアルの案内（4-11）・
// フリーフライトのマップと天候（6-4・7-5）・レイドの人数と難易度（6-2・6-6）・防衛戦の人数・マップ・難易度（7-2）。
// 選択はセグメント（ui/segmented.ts。高さ 48px 以上・選択中は塗りつぶし）、決定は下のボタン
import { prefetchKaiju2 } from './kaiju2-link';
import { t } from '../core/i18n';
import { DEFENSE_MAPS, type DefenseDifficulty } from '../data/defense';
import { ISLAND_MAP, SELECTABLE_MAPS } from '../data/maps';
import { RAID_DIFFICULTY_LABELS, type RaidDifficulty } from '../data/raid';
import { DEFAULT_WEATHER_ID, WEATHER_PRESETS, weatherLabel } from '../data/weather';
import { raidVariants } from '../missions/raid-variants';
import { el } from './hud-dom';
import { createButton } from './screen';
import { noteScreenSwitch } from './screen-switch';
import { Segmented } from './segmented';
import type { TutorialStrings } from './tutorial-text';

export interface ModeDialogHandlers {
  /** チュートリアルを始める・フリーフライトに出る */
  readonly onStart: (mode: 'tutorial' | 'free') => void;
  /** solo はすぐ出撃、coop は PvP のロビーへ（difficulty はソロの難易度。協力はロビーでホストが選ぶ） */
  readonly onRaid: (kind: 'solo' | 'coop', difficulty: RaidDifficulty, kaiju?: string) => void;
  /** solo はすぐ出撃、coop は PvP のロビーへ（マップと難易度はホストの初期設定） */
  readonly onDefense: (kind: 'solo' | 'coop', mapId: string, difficulty: DefenseDifficulty) => void;
  /** 閉じた（「戻る」「あとで」）。モードの一覧にフォーカスを戻す */
  readonly onClose: () => void;
}

const DIFFICULTY_OPTIONS = [
  {
    value: 'normal',
    get label() {
      return RAID_DIFFICULTY_LABELS.normal;
    },
  },
  {
    value: 'hard',
    get label() {
      return RAID_DIFFICULTY_LABELS.hard;
    },
  },
] as const;

/** ヴォルガス（レイドの怪獣の既定） */
const VORGAS = 'vorgas';

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
  /** 9-6b: レイドの怪獣（'vorgas' か、登録された怪獣の id。9-6c からネフィルガは起動時に登録） */
  raidKaiju = VORGAS;

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
  private readonly raidTitle: HTMLElement;
  private readonly raidBody: HTMLElement;
  private readonly raidKaijuSlot: HTMLDivElement;
  private raidKaijuSeg: Segmented | null = null;
  private readonly defenseWrap: HTMLDivElement;
  private readonly defenseSolo: HTMLButtonElement;
  private readonly defenseMap: Segmented;
  private readonly defenseDiff: Segmented;

  constructor(root: HTMLElement, tutorial: TutorialStrings, h: ModeDialogHandlers) {
    const back = (parent: HTMLElement, label = t('modes.dialog.back')): void => {
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
    [this.freeWrap, box] = this.dialog(root, t('modes.free.label'));
    box.classList.add('mode-prompt-wide');
    this.freeMap = new Segmented(
      box,
      t('modes.dialog.map'),
      SELECTABLE_MAPS.map((m) => ({ value: m.id, label: m.name })),
      this.freeMapId,
      (v) => (this.freeMapId = v),
    );
    this.freeWeather = new Segmented(
      box,
      t('modes.dialog.weather'),
      WEATHER_PRESETS.map((w) => ({ value: w.id, label: weatherLabel(w.id) })),
      this.freeWeatherId,
      (v) => (this.freeWeatherId = v),
      'mode-seg-weather',
    );
    this.freeTime = new Segmented(
      box,
      t('modes.dialog.time'),
      [
        { value: 'fixed', label: t('modes.dialog.timeFixed') },
        { value: 'flow', label: t('modes.dialog.timeFlow') },
      ],
      'fixed',
      (v) => (this.freeTimeFlow = v === 'flow'),
    );
    buttons = el('div', 'campaign-buttons', box);
    back(buttons);
    this.freeGo = go(buttons, t('modes.dialog.launch'), true, () => {
      h.onStart('free');
    });

    // レイド（6-2・6-6）: 高難度は HP ×1.4・予兆 −0.5 秒・最終フェーズ 3.5 分・報酬 ×1.8
    [this.raidWrap, box] = this.dialog(
      root,
      t('modes.raidDialog.title'),
      t('modes.raidDialog.body'),
    );
    this.raidTitle = box.querySelector('.mode-prompt-title') ?? box;
    this.raidBody = box.querySelector('.mode-prompt-text') ?? box;
    // 9-6b: 怪獣の選択（別の怪獣が登録されているときだけ、開くときに作る）
    this.raidKaijuSlot = el('div', 'mode-raid-kaiju', box);
    this.raidKaijuSlot.hidden = true;
    this.raidDiff = new Segmented(
      box,
      t('modes.raidDialog.difficulty'),
      DIFFICULTY_OPTIONS,
      this.raidDifficulty,
      (v) => (this.raidDifficulty = asDifficulty(v)),
    );
    buttons = el('div', 'campaign-buttons', box);
    back(buttons);
    go(buttons, t('modes.dialog.coop'), false, () => {
      // 9-6c: ネフィルガも協力できる（怪獣はロビーのホストの設定の初めの値。難易度はロビーで選ぶ）
      if (this.raidKaiju === VORGAS) h.onRaid('coop', 'normal');
      else h.onRaid('coop', 'normal', this.raidKaiju);
    });
    this.raidSolo = go(buttons, t('modes.dialog.solo'), true, () => {
      if (this.raidKaiju === VORGAS) h.onRaid('solo', this.raidDifficulty);
      else h.onRaid('solo', this.raidDifficulty, this.raidKaiju);
    });

    // 防衛戦（7-2）
    [this.defenseWrap, box] = this.dialog(
      root,
      t('modes.defense.label'),
      t('modes.defenseDialog.body'),
    );
    this.defenseMap = new Segmented(
      box,
      t('modes.dialog.map'),
      DEFENSE_MAPS.map((m) => ({ value: m.mapId, label: m.name })),
      this.defenseMapId,
      (v) => (this.defenseMapId = v),
    );
    this.defenseDiff = new Segmented(
      box,
      t('modes.defenseDialog.difficulty'),
      DIFFICULTY_OPTIONS,
      this.defenseDifficulty,
      (v) => (this.defenseDifficulty = asDifficulty(v)),
    );
    buttons = el('div', 'campaign-buttons', box);
    back(buttons);
    go(buttons, t('modes.dialog.coop'), false, () => {
      h.onDefense('coop', this.defenseMapId, this.defenseDifficulty);
    });
    this.defenseSolo = go(buttons, t('modes.dialog.solo'), true, () => {
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
    this.syncRaidKaiju();
    this.open(this.raidWrap, this.raidSolo);
  }

  /** 9-6b: 別の怪獣が登録されていれば、怪獣の選択を出す。9-6c: 協力も選べる・ネフィルガを選んだら先読み */
  private syncRaidKaiju(): void {
    const variants = raidVariants();
    if (variants.length === 0) return;
    if (!this.raidKaijuSeg) {
      this.raidKaijuSlot.hidden = false;
      this.raidTitle.textContent = t('modes.raid.label');
      this.raidKaijuSeg = new Segmented(
        this.raidKaijuSlot,
        '',
        [
          { value: VORGAS, label: t('kaiju.name') },
          ...variants.map((v) => ({ value: v.id, label: v.label() })),
        ],
        this.raidKaiju,
        (v) => {
          this.raidKaiju = v;
          this.syncRaidBody();
          if (v !== VORGAS) prefetchKaiju2();
        },
      );
    }
    this.raidKaijuSeg.value = this.raidKaiju;
    this.syncRaidBody();
  }

  /** 9-6c: 説明の文（高難度の中身）を選んだ怪獣に合わせる */
  private syncRaidBody(): void {
    this.raidBody.textContent = t(
      this.raidKaiju === VORGAS ? 'modes.raidDialog.body' : 'modes.raidDialog.bodyNephirga',
    );
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
    // 9-11a: 閉じて出たモード選択のカード・タイル（「戻る」の下のリプレイなど）へ、同じタップが押し抜けない
    noteScreenSwitch();
    return true;
  }

  private open(wrap: HTMLDivElement, focus: HTMLButtonElement): void {
    this.close();
    // 9-9b: カードを押して出たダイアログのボタンへ、同じタップが押し抜けない
    noteScreenSwitch();
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

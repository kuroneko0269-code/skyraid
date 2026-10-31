import { parseUnlockAll } from '../core/debug-flags';
import { usesDemoCamera, type GameState, type ScreenState } from '../core/game-state';
import { detectLocale } from '../core/locale';
import type { MissionResult } from '../missions/runner';
import type { MissionDef } from '../missions/types';
import type { AircraftModel } from '../data/aircraft';
import { CampaignProgress } from '../progression/campaign-progress';
import { Hangar } from '../progression/hangar';
import type { SaveStore } from '../progression/save-store';
import { BriefingScreen } from './briefing';
import { HangarScreen } from './hangar';
import { MissionSelectScreen } from './mission-select';
import { ModeSelectScreen } from './mode-select';
import { PauseMenu, createPauseButton } from './pause';
import { PilotNameScreen } from './pilot-name';
import { ResultScreen } from './result';
import { FadeCurtain, LoadingScreen, applyScreenFade } from './screen';
import { syncHudScreen } from './hud-screen';
import { TitleScreen } from './title';
import { TUTORIAL_MISSION } from '../data/tutorial';
import { MAPS } from '../data/maps';
import { RAID_MISSION, raidMission } from '../data/missions-special';
import type { DefenseDifficulty } from '../data/defense';
import { tutorialStrings, type TutorialStrings } from './tutorial-text';

interface PvpHandlers {
  onSelect: (raid: boolean) => void;
  onBack: () => void;
  onPause: () => boolean;
}

/**
 * 画面（読み込み中・タイトル・モード選択・ミッション一覧・ブリーフィング・ハンガー・ポーズ・リザルト）の DOM をまとめ、GameState の
 * 遷移に合わせて切り替える。ボタンは transition を呼ぶだけで、遷移後の処理（飛行の開始など）は main がイベントで行う。レースは race-link.ts
 */
export class Screens {
  readonly loading: LoadingScreen;
  readonly title: TitleScreen;
  readonly pilotName: PilotNameScreen;
  readonly modeSelect: ModeSelectScreen;
  readonly missionSelect: MissionSelectScreen;
  readonly briefing: BriefingScreen;
  readonly result: ResultScreen;
  readonly hangarScreen: HangarScreen;
  /** 機体の所持・強化・選択（3-3） */
  readonly hangar: Hangar;
  readonly pause: PauseMenu;
  readonly pauseButton: HTMLButtonElement;
  /** ミッション一覧で選んだミッション（ブリーフィング・もう一度で使う） */
  selectedMission: MissionDef | null = null;
  /** 次に飛行へ入るときのミッション（null はフリーフライト。チュートリアル（4-11）・ブリーフィングの出撃で決める） */
  nextMission: MissionDef | null = null;
  /** チュートリアルの文（4-11） */
  readonly tutorialText: TutorialStrings;
  /** ミッションの解放とクリア済みのランク（2-5。3-1 からセーブに記録） */
  readonly progress: CampaignProgress;
  private readonly curtain: FadeCurtain;
  /** ハンガーを閉じたら戻る画面（モード選択かブリーフィング） */
  private hangarReturn: 'mode_select' | 'briefing' = 'mode_select';
  /** パイロット名を決めた後に呼ぶ（?room で初回起動したとき、ロビーへ。5-4） */
  private afterPilotName: (() => void) | null = null;
  private readonly viewListeners: ((model: AircraftModel) => void)[] = [];
  /** リングレース（7-1）を飛んでいる（終えたばかり）か。リザルト・ポーズの「中断」の戻り先をコース一覧にする（main が差し込む） */
  inRace: () => boolean = () => false;
  /** 防衛戦（7-2。ui/defense-link.ts が差し込む）: 飛んでいるか・モード選択の「防衛戦」の選択 */
  inDefense: () => boolean = () => false;
  onDefense: (kind: 'solo' | 'coop', mapId: string, difficulty: DefenseDifficulty) => void = () =>
    undefined;
  /** PvP（5-1）: モード選択の「PvP」（raid: 協力レイド（6-2）の部屋）・ロビーの Esc・飛行中の ⏸（main が差し込む） */
  private pvp: PvpHandlers | null = null;

  constructor(
    parent: HTMLElement,
    game: GameState,
    missions: readonly MissionDef[],
    /** セーブ（3-1）: 進み具合・残高・パイロット名 */
    private readonly save: SaveStore,
    /** ポーズメニューの「ミッションを中断」（遷移の前に呼ぶ） */
    private readonly onAbortMission: () => void,
  ) {
    applyScreenFade(document.documentElement);
    const search = window.location.search;
    const locale = detectLocale(search, navigator.languages);
    this.tutorialText = tutorialStrings(locale);
    this.progress = new CampaignProgress(
      missions.map((m) => m.id),
      save,
      parseUnlockAll(search),
    );
    this.hangar = new Hangar(save, (id) => this.progress.isCleared(id));
    const missionIds = missions.map((m) => m.id);
    // 初回起動（パイロット名がまだない）はタイトルの後に名前の入力（3-1）
    this.title = new TitleScreen(parent, () =>
      game.transition(save.needsPilotName ? 'pilot_name' : 'mode_select'),
    );
    this.title.setPilotName(save.pilotName);
    this.pilotName = new PilotNameScreen(parent, {
      onSubmit: (name) => {
        this.title.setPilotName(save.setPilotName(name));
        game.transition('mode_select');
        // ?room から来た（5-4）: チュートリアルの案内を出さずにロビーへ
        const after = this.afterPilotName;
        this.afterPilotName = null;
        if (after) {
          after();
          return;
        }
        // 初回起動だけ「チュートリアルを始めますか？」（4-11。1 度だけ）
        if (!save.flag('tutorialOffered')) {
          save.setFlag('tutorialOffered');
          this.modeSelect.showTutorialPrompt();
        }
      },
    });
    this.modeSelect = new ModeSelectScreen(parent, this.tutorialText, {
      onSelect: (mode) => {
        if (mode === 'free' || mode === 'tutorial') {
          this.nextMission = mode === 'tutorial' ? TUTORIAL_MISSION : null;
          game.transition('flight');
        } else if (mode === 'campaign') game.transition('mission_select');
        else if (mode === 'race') game.transition('race_select');
        else if (mode === 'hangar') this.openHangar(game, 'mode_select');
        else if (mode === 'pvp') this.pvp?.onSelect(false);
        else if (mode === 'defense') this.modeSelect.showDefensePrompt();
        else this.modeSelect.showRaidPrompt();
      },
      onDefense: (kind, mapId, difficulty) => {
        this.onDefense(kind, mapId, difficulty);
      },
      onRaid: (kind, difficulty) => {
        if (kind === 'coop') {
          this.pvp?.onSelect(true);
          return;
        }
        this.nextMission = raidMission(difficulty);
        game.transition('flight');
      },
      onBack: () => game.transition('title'),
    });
    this.missionSelect = new MissionSelectScreen(
      parent,
      missions,
      this.progress,
      () => save.credits,
      locale,
      {
        onSelect: (mission) => {
          this.selectedMission = mission;
          // PvP のロビーで機体を変えた後でも今の機体名を出す（5-4）
          this.briefing.setAircraftName(this.hangar.selectedModel.name);
          this.briefing.show(mission);
          game.transition('briefing');
        },
        onBack: () => game.transition('mode_select'),
      },
    );
    this.briefing = new BriefingScreen(parent, locale, {
      onLaunch: () => {
        this.nextMission = this.selectedMission;
        game.transition('flight');
      },
      onBack: () => game.transition('mission_select'),
      onHangar: () => {
        this.openHangar(game, 'briefing');
      },
    });
    this.briefing.setAircraftName(this.hangar.selectedModel.name);
    this.hangarScreen = new HangarScreen(parent, this.hangar, {
      onBack: () => {
        this.closeHangar(game);
      },
      onView: (model) => {
        for (const fn of this.viewListeners) fn(model);
      },
      unlockText: (id) => {
        const i = missionIds.indexOf(id);
        return i >= 0 ? `M${i + 1} クリアで解放` : '未解放';
      },
    });
    this.result = new ResultScreen(parent, {
      onRetry: () => game.transition('flight'),
      onList: () => game.transition(this.listState()),
    });
    this.pause = new PauseMenu(parent, {
      onResume: () => game.transition('flight'),
      onTitle: () => game.transition('title'),
      onAbort: () => {
        onAbortMission();
        game.transition(this.listState());
      },
    });
    // PvP の飛行中はゲームを止めずに PvP のメニュー
    this.pauseButton = createPauseButton(parent, () => {
      if (!this.pvp?.onPause()) game.transition('pause');
    });
    this.loading = new LoadingScreen(parent);
    this.curtain = new FadeCurtain(parent);
    // 開発用: ?map=harbor でフリーフライト（?skipTitle も）のマップを選ぶ（6-4）
    const mapParam = new URLSearchParams(search).get('map');
    if (mapParam && MAPS[mapParam]) this.modeSelect.freeMapId = mapParam;
    this.show(game.state);
    game.onChange(({ from, to }) => {
      // デモカメラ ⇄ 追従カメラの切り替わり（とリザルトからのやり直し）は暗転で隠す（読み込み画面からは不要）
      const cut =
        (from !== 'boot' && usesDemoCamera(from) !== usesDemoCamera(to)) ||
        (from === 'result' && to === 'flight');
      if (cut) this.curtain.cut();
      this.show(to);
    });
  }

  /** チュートリアルの指示の「中断」（4-11）: ランナーを止めてモード選択へ */
  abortTutorial(game: GameState): void {
    this.onAbortMission();
    game.transition('mode_select');
  }

  /** チュートリアル（4-11）を飛んでいる（または終えたばかり） */
  get inTutorial(): boolean {
    return this.nextMission?.id === TUTORIAL_MISSION.id;
  }

  /** ソロのレイド（6-2）を飛んでいる（または終えたばかり） */
  get inRaid(): boolean {
    return this.nextMission?.id === RAID_MISSION.id;
  }

  /** リザルト・ポーズの「中断」の戻り先: レースはコース一覧、チュートリアル・レイドはモード選択、ほかはミッション一覧 */
  private listState(): ScreenState {
    if (this.inRace()) return 'race_select';
    if (this.inDefense()) return 'mode_select';
    return this.inTutorial || this.inRaid ? 'mode_select' : 'mission_select';
  }

  /** PvP（5-1）の入口をつなぐ */
  setPvpHandlers(handlers: PvpHandlers): void {
    this.pvp = handlers;
  }

  /** パイロット名を決めた後の行き先（5-4。?room の参加） */
  setAfterPilotName(fn: () => void): void {
    this.afterPilotName = fn;
  }

  /** ハンガーで見ている機体が変わったとき（展示の形） */
  onAircraftView(fn: (model: AircraftModel) => void): void {
    this.viewListeners.push(fn);
  }

  /** ハンガーを開く。閉じると from へ戻る */
  openHangar(game: GameState, from: 'mode_select' | 'briefing'): void {
    this.hangarReturn = from;
    game.transition('hangar');
  }

  /** Esc / Start（メニュー中）: ポーズ → 再開、モード選択 → タイトルなど 1 つ前の画面へ */
  navigateBack(game: GameState): void {
    const state = game.state;
    if (state === 'pause' || state === 'photo') game.transition('flight');
    else if (state === 'mode_select') {
      if (!this.modeSelect.closeDialog()) game.transition('title');
    } else if (state === 'pilot_name') game.transition('title');
    else if (state === 'mission_select' || state === 'race_select') game.transition('mode_select');
    else if (state === 'briefing') game.transition('mission_select');
    else if (state === 'hangar') this.closeHangar(game);
    else if (state === 'lobby') this.pvp?.onBack();
  }

  /** ハンガーを閉じる（← 戻る・Esc）。確認ダイアログが開いていればそれだけ閉じる */
  closeHangar(game: GameState): void {
    if (this.hangarScreen.closeDialog()) return;
    this.briefing.setAircraftName(this.hangar.selectedModel.name);
    game.transition(this.hangarReturn);
  }

  /**
   * リザルトを出す。クリアの記録と報酬はミッションの終わりのイベントでセーブに入っている
   * （progression/mission-rewards.ts）ので、ここは残高を読むだけ
   */
  showResult(result: MissionResult, tutorialPaid = 0): void {
    const balance = this.save.credits;
    // チュートリアル（4-11）: 報酬は初回だけ（払った額を出す）。ランクは出さない
    const tutorial = this.inTutorial;
    const r = tutorial ? { ...result, credits: tutorialPaid, rank: null } : result;
    // 報酬で新しく機体・強化が買える残高になったら 1 行出す（3-3）
    const newGear = this.hangar.newlyAffordable(balance - r.credits, balance);
    const t = this.tutorialText;
    this.result.show(r, {
      balance,
      pilotName: this.save.pilotName,
      newGear,
      tutorial: tutorial ? { title: t.complete, back: t.back } : undefined,
    });
  }

  private show(state: ScreenState): void {
    document.documentElement.dataset.screen = state;
    syncHudScreen(document.documentElement, state);
    this.loading.setShown(state === 'boot');
    this.title.setShown(state === 'title');
    this.pilotName.setShown(state === 'pilot_name');
    this.modeSelect.setShown(state === 'mode_select');
    this.missionSelect.setShown(state === 'mission_select');
    this.briefing.setShown(state === 'briefing');
    this.pause.setShown(state === 'pause');
    this.result.setShown(state === 'result' && !this.inRace() && !this.inDefense());
    this.hangarScreen.setShown(state === 'hangar');
  }
}

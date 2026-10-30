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
import { TitleScreen } from './title';

/**
 * 画面（読み込み中・タイトル・モード選択・ミッション一覧・ブリーフィング・ハンガー・ポーズ・リザルト）の DOM をまとめ、
 * GameState の遷移に合わせて切り替える。ボタンは GameState.transition を呼ぶだけで、
 * 遷移後の処理（飛行・ミッションの開始など）は main がイベントで行う
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
  /** ミッションの解放とクリア済みのランク（2-5。3-1 からセーブに記録） */
  readonly progress: CampaignProgress;
  private readonly curtain: FadeCurtain;
  /** ハンガーを閉じたら戻る画面（モード選択かブリーフィング） */
  private hangarReturn: 'mode_select' | 'briefing' = 'mode_select';
  private readonly viewListeners: ((model: AircraftModel) => void)[] = [];

  constructor(
    parent: HTMLElement,
    game: GameState,
    missions: readonly MissionDef[],
    /** セーブ（3-1）: 進み具合・残高・パイロット名 */
    private readonly save: SaveStore,
    /** ポーズメニューの「ミッションを中断」（遷移の前に呼ぶ） */
    onAbortMission: () => void,
  ) {
    applyScreenFade(document.documentElement);
    const search = window.location.search;
    const locale = detectLocale(search, navigator.languages);
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
      },
    });
    this.modeSelect = new ModeSelectScreen(parent, {
      // PvP・レイドは disabled
      onSelect: (mode) => {
        if (mode === 'free') game.transition('flight');
        else if (mode === 'campaign') game.transition('mission_select');
        else if (mode === 'hangar') this.openHangar(game, 'mode_select');
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
          this.briefing.show(mission);
          game.transition('briefing');
        },
        onBack: () => game.transition('mode_select'),
      },
    );
    this.briefing = new BriefingScreen(parent, locale, {
      onLaunch: () => game.transition('flight'),
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
      onList: () => game.transition('mission_select'),
    });
    this.pause = new PauseMenu(parent, {
      onResume: () => game.transition('flight'),
      onTitle: () => game.transition('title'),
      onAbort: () => {
        onAbortMission();
        game.transition('mission_select');
      },
    });
    this.pauseButton = createPauseButton(parent, () => game.transition('pause'));
    this.loading = new LoadingScreen(parent);
    this.curtain = new FadeCurtain(parent);
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

  /** ハンガーで見ている機体が変わったとき（展示の形） */
  onAircraftView(fn: (model: AircraftModel) => void): void {
    this.viewListeners.push(fn);
  }

  /** ハンガーを開く。閉じると from へ戻る */
  openHangar(game: GameState, from: 'mode_select' | 'briefing'): void {
    this.hangarReturn = from;
    game.transition('hangar');
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
  showResult(result: MissionResult): void {
    const balance = this.save.credits;
    // 報酬で新しく機体・強化が買える残高になったら 1 行出す（3-3）
    const newGear = this.hangar.newlyAffordable(balance - result.credits, balance);
    this.result.show(result, { balance, pilotName: this.save.pilotName, newGear });
  }

  private show(state: ScreenState): void {
    document.documentElement.dataset.screen = state;
    this.loading.setShown(state === 'boot');
    this.title.setShown(state === 'title');
    this.pilotName.setShown(state === 'pilot_name');
    this.modeSelect.setShown(state === 'mode_select');
    this.missionSelect.setShown(state === 'mission_select');
    this.briefing.setShown(state === 'briefing');
    this.pause.setShown(state === 'pause');
    this.result.setShown(state === 'result');
    this.hangarScreen.setShown(state === 'hangar');
  }
}

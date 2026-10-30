import { parseUnlockAll } from '../core/debug-flags';
import { usesDemoCamera, type GameState, type ScreenState } from '../core/game-state';
import { detectLocale } from '../core/locale';
import type { MissionResult } from '../missions/runner';
import type { MissionDef } from '../missions/types';
import { CampaignProgress } from '../progression/campaign-progress';
import type { SaveStore } from '../progression/save-store';
import { BriefingScreen } from './briefing';
import { MissionSelectScreen } from './mission-select';
import { ModeSelectScreen } from './mode-select';
import { PauseMenu, createPauseButton } from './pause';
import { PilotNameScreen } from './pilot-name';
import { ResultScreen } from './result';
import { FadeCurtain, LoadingScreen, applyScreenFade } from './screen';
import { TitleScreen } from './title';

/**
 * 画面（読み込み中・タイトル・モード選択・ミッション一覧・ブリーフィング・ポーズ・リザルト）の DOM をまとめ、
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
  readonly pause: PauseMenu;
  readonly pauseButton: HTMLButtonElement;
  /** ミッション一覧で選んだミッション（ブリーフィング・もう一度で使う） */
  selectedMission: MissionDef | null = null;
  /** ミッションの解放とクリア済みのランク（2-5。3-1 からセーブに記録） */
  readonly progress: CampaignProgress;
  private readonly curtain: FadeCurtain;

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

  /**
   * リザルトを出す。クリアの記録と報酬はミッションの終わりのイベントでセーブに入っている
   * （progression/mission-rewards.ts）ので、ここは残高を読むだけ
   */
  showResult(result: MissionResult): void {
    this.result.show(result, { balance: this.save.credits, pilotName: this.save.pilotName });
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
  }
}

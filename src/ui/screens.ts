import { usesDemoCamera, type GameState, type ScreenState } from '../core/game-state';
import { ModeSelectScreen } from './mode-select';
import { PauseMenu, createPauseButton } from './pause';
import { FadeCurtain, LoadingScreen, applyScreenFade } from './screen';
import { TitleScreen } from './title';

/**
 * 画面（読み込み中・タイトル・モード選択・ポーズ）の DOM をまとめ、GameState の遷移に合わせて切り替える。
 * ボタンは GameState.transition を呼ぶだけで、遷移後の処理（飛行開始など）は main がイベントで行う
 */
export class Screens {
  readonly loading: LoadingScreen;
  readonly title: TitleScreen;
  readonly modeSelect: ModeSelectScreen;
  readonly pause: PauseMenu;
  readonly pauseButton: HTMLButtonElement;
  private readonly curtain: FadeCurtain;

  constructor(parent: HTMLElement, game: GameState) {
    applyScreenFade(document.documentElement);
    this.title = new TitleScreen(parent, () => game.transition('mode_select'));
    this.modeSelect = new ModeSelectScreen(parent, {
      // 今はフリーフライトだけ選べる（他は disabled）
      onSelect: (mode) => {
        if (mode === 'free') game.transition('flight');
      },
      onBack: () => game.transition('title'),
    });
    this.pause = new PauseMenu(parent, {
      onResume: () => game.transition('flight'),
      onTitle: () => game.transition('title'),
    });
    this.pauseButton = createPauseButton(parent, () => game.transition('pause'));
    this.loading = new LoadingScreen(parent);
    this.curtain = new FadeCurtain(parent);
    this.show(game.state);
    game.onChange(({ from, to }) => {
      // デモカメラ ⇄ 追従カメラの切り替わりは暗転で隠す（読み込み画面からは不要）
      if (from !== 'boot' && usesDemoCamera(from) !== usesDemoCamera(to)) this.curtain.cut();
      this.show(to);
    });
  }

  private show(state: ScreenState): void {
    document.documentElement.dataset.screen = state;
    this.loading.setShown(state === 'boot');
    this.title.setShown(state === 'title');
    this.modeSelect.setShown(state === 'mode_select');
    this.pause.setShown(state === 'pause');
  }
}

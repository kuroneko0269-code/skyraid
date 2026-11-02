// 設定画面の開閉（7-D）: 開いた元（タイトル / モード選択 / ポーズ）を隠して設定画面を重ね、「戻る」・Esc で元を出し直す。
// 画面の状態（GameState）は変えない（core/settings-route.ts）。ポーズから開いても飛行は止まったまま
import type { GameState } from '../core/game-state';
import { t } from '../core/i18n';
import { SettingsRoute, type SettingsOrigin } from '../core/settings-route';
import type { ModeSelectScreen } from './mode-select';
import type { PauseMenu } from './pause';
import { setScreenShown } from './screen';
import type { SettingsScreen } from './settings-screen';
import type { TitleScreen } from './title';

const BACK_LABELS: Readonly<Record<SettingsOrigin, string>> = {
  get title() {
    return t('settings.back.title');
  },
  get mode_select() {
    return t('settings.back.modeSelect');
  },
  get pause() {
    return t('settings.back.pause');
  },
};

export interface SettingsOrigins {
  readonly title: TitleScreen;
  readonly modeSelect: ModeSelectScreen;
  readonly pause: PauseMenu;
}

export class SettingsNav {
  readonly route = new SettingsRoute();

  constructor(
    private readonly game: GameState,
    private readonly screen: SettingsScreen,
    private readonly origins: SettingsOrigins,
  ) {
    // 開いたまま別の画面へ移ったら（同期のダイアログ・切断など）閉じる
    game.onChange(({ to }) => {
      if (this.route.follow(to)) this.screen.setShown(false);
    });
  }

  get isOpen(): boolean {
    return this.route.isOpen;
  }

  /** 今の画面から設定画面を開く。開けない画面なら false */
  open(): boolean {
    if (!this.route.open(this.game.state)) return false;
    const origin = this.route.origin;
    if (origin === 'title') this.origins.title.setShown(false);
    else if (origin === 'mode_select') setScreenShown(this.origins.modeSelect.root, false);
    else setScreenShown(this.origins.pause.root, false);
    this.screen.setShown(true, origin ? BACK_LABELS[origin] : undefined);
    return true;
  }

  /** 閉じて開いた元へ戻る。開いていなければ false */
  close(): boolean {
    const origin = this.route.close();
    if (!origin) return false;
    this.screen.setShown(false);
    if (origin === 'title') this.origins.title.setShown(true);
    else if (origin === 'mode_select') this.origins.modeSelect.reveal();
    else {
      this.screen.lend(this.origins.pause.quick);
      this.origins.pause.setShown(true);
      this.origins.pause.focusResume();
    }
    return true;
  }
}

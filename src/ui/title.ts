import './title.css';
import { createScreen, setScreenShown } from './screen';

/**
 * タイトル画面。背景は実際のシーン（デモカメラ）で、ここは文字だけの DOM。
 * ロゴは「SkyRaid」のテキスト + CSS のみ（サブタイトルなし。画像・Web フォントなし）。画面のどこをタップしても / Enter で開始
 */
export class TitleScreen {
  readonly root: HTMLDivElement;
  private shown = false;

  constructor(
    parent: HTMLElement,
    private readonly onStart: () => void,
  ) {
    const root = createScreen(parent, 'title-screen');
    root.innerHTML =
      '<div class="title-logo">' +
      '<span class="title-logo-main">SkyRaid</span>' +
      '</div>' +
      '<div class="title-prompt">タップ / Enter で開始</div>';
    root.addEventListener('click', this.start);
    window.addEventListener('keydown', this.onKeyDown);
    this.root = root;
  }

  setShown(shown: boolean): void {
    this.shown = shown;
    setScreenShown(this.root, shown);
  }

  private readonly start = (): void => {
    if (this.shown) this.onStart();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.shown || e.repeat) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.start();
    }
  };
}

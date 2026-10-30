import './title.css';
import './save.css';
import { el } from './hud-dom';
import { createScreen, setScreenShown } from './screen';

/**
 * タイトル画面。背景は実際のシーン（デモカメラ）で、ここは文字だけの DOM。
 * ロゴは「SkyRaid」のテキスト + CSS のみ（サブタイトルなし。画像・Web フォントなし）。画面のどこをタップしても / Enter で開始。
 * 右下にパイロット名（3-1。未入力の初回起動では出さない）
 */
export class TitleScreen {
  readonly root: HTMLDivElement;
  private readonly pilot: HTMLDivElement;
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
    this.pilot = el('div', 'title-pilot', root);
    this.pilot.hidden = true;
    root.addEventListener('click', this.start);
    window.addEventListener('keydown', this.onKeyDown);
    this.root = root;
  }

  /** 右下のパイロット名（null なら隠す） */
  setPilotName(name: string | null): void {
    this.pilot.textContent = name === null ? '' : `PILOT  ${name}`;
    this.pilot.hidden = name === null;
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

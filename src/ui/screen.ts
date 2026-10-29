import './screen.css';
import { SCREEN_CONFIG } from '../data/screens';

/** フェード時間を CSS 変数 --screen-fade にする（画面・暗転幕・HUD の transition が使う） */
export function applyScreenFade(root: HTMLElement): void {
  root.style.setProperty('--screen-fade', `${SCREEN_CONFIG.fadeSeconds}s`);
}

/** 全画面のメニュー層を作る。表示の切り替えは setScreenShown（CSS transition でフェード） */
export function createScreen(parent: HTMLElement, className: string): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = `screen ${className}`;
  screen.inert = true;
  parent.appendChild(screen);
  return screen;
}

/**
 * 表示・非表示を切り替える。隠した画面は inert にして、フェード中のタップ・フォーカスを受けない。
 * フォーカスが残っていると Space（機銃）でボタンが押されるので外す
 */
export function setScreenShown(screen: HTMLElement, shown: boolean): void {
  screen.classList.toggle('is-shown', shown);
  if (
    !shown &&
    document.activeElement instanceof HTMLElement &&
    screen.contains(document.activeElement)
  )
    document.activeElement.blur();
  screen.inert = !shown;
}

/** ボタンを作る。押したらフォーカスを外す（Space・矢印キーが飛行操作に使われるため） */
export function createButton(
  parent: HTMLElement,
  className: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', () => {
    button.blur();
    onClick();
  });
  parent.appendChild(button);
  return button;
}

/**
 * カメラが切り替わる遷移（デモカメラ ⇄ 追従カメラ）を隠す暗転幕。
 * cut() で一瞬で黒にし、CSS transition で 0.3 秒かけて透明に戻す
 */
export class FadeCurtain {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'fade-curtain';
    parent.appendChild(this.root);
  }

  cut(): void {
    const root = this.root;
    root.classList.add('is-cut');
    // スタイルを確定させてからクラスを外すと、黒 → 透明の transition が走る
    root.getBoundingClientRect();
    root.classList.remove('is-cut');
  }
}

/** 読み込み中の表示（起動シーケンスの受け口）。進捗は 0〜1 */
export class LoadingScreen {
  readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = createScreen(parent, 'loading-screen');
    const text = document.createElement('div');
    text.className = 'loading-text';
    text.textContent = '読み込み中…';
    const track = document.createElement('div');
    track.className = 'loading-track';
    this.bar = document.createElement('div');
    this.bar.className = 'loading-bar';
    track.appendChild(this.bar);
    this.root.append(text, track);
    setScreenShown(this.root, true);
  }

  setProgress(progress: number): void {
    this.bar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress)).toFixed(3)})`;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
  }
}

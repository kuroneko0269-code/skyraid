import './pause.css';
import { SCREEN_CONFIG } from '../data/screens';
import { TOUCH_CONFIG } from '../data/touch';
import { createButton, createScreen, setScreenShown } from './screen';

/**
 * ポーズメニュー（再開 / 設定 / ミッションを中断（ミッション中だけ）/ タイトルへ）。設定（画質・タッチ・HUD・全画面）の部品は
 * main で settings に入れる。「設定」ボタンで開閉し、開閉状態はメニューを閉じても保つ
 */
export class PauseMenu {
  readonly root: HTMLDivElement;
  /** 設定の部品を入れる場所 */
  readonly settings: HTMLDivElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly abortButton: HTMLButtonElement;
  private settingsOpen = false;

  constructor(
    parent: HTMLElement,
    handlers: { onResume: () => void; onTitle: () => void; onAbort: () => void },
  ) {
    const root = createScreen(parent, 'pause-screen');
    const panel = document.createElement('div');
    panel.className = 'pause-panel';
    const heading = document.createElement('h2');
    heading.className = 'pause-heading';
    heading.textContent = 'ポーズ';
    panel.appendChild(heading);
    root.appendChild(panel);

    createButton(panel, 'menu-button', '再開', handlers.onResume);
    this.settingsButton = createButton(panel, 'menu-button', '設定', () => {
      this.setSettingsOpen(!this.settingsOpen);
    });
    this.settings = document.createElement('div');
    this.settings.className = 'pause-settings';
    panel.appendChild(this.settings);
    // ミッション中だけ出す（2-4）
    this.abortButton = createButton(
      panel,
      'menu-button pause-title',
      'ミッションを中断',
      handlers.onAbort,
    );
    this.abortButton.hidden = true;
    createButton(panel, 'menu-button pause-title', 'タイトルへ', handlers.onTitle);
    this.setSettingsOpen(false);
    this.root = root;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
  }

  /** ミッション中か（「ミッションを中断」を出す） */
  setInMission(inMission: boolean): void {
    this.abortButton.hidden = !inMission;
  }

  private setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
    this.settings.hidden = !open;
    this.settingsButton.textContent = open ? '設定 ▲' : '設定 ▼';
    this.settingsButton.setAttribute('aria-expanded', String(open));
  }
}

/**
 * 飛行中だけ出す ⏸ ボタン（右上）。タッチ操作中は右上のヨーボタンの左隣に置く。
 * 表示は CSS（:root[data-screen='flight']）で切り替える
 */
export function createPauseButton(parent: HTMLElement, onPress: () => void): HTMLButtonElement {
  const c = SCREEN_CONFIG.pauseButton;
  const yaw = TOUCH_CONFIG.yaw;
  const button = createButton(parent, 'pause-button', '⏸', onPress);
  button.setAttribute('aria-label', 'ポーズ');
  const vars: Record<string, string> = {
    '--pause-size': `${c.size}px`,
    '--pause-margin': `${TOUCH_CONFIG.edgeMargin}px`,
    // ヨーボタンと上下中央をそろえ、横に gap 空ける
    '--pause-top': `${yaw.top + (yaw.size - c.size) / 2}px`,
    '--pause-touch-right': `${TOUCH_CONFIG.edgeMargin + yaw.size + c.gap}px`,
  };
  for (const [name, value] of Object.entries(vars)) button.style.setProperty(name, value);
  return button;
}

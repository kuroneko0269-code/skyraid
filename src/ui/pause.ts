import { t } from '../core/i18n';
import './pause.css';
import { SCREEN_CONFIG } from '../data/screens';
import { TOUCH_CONFIG } from '../data/touch';
import { createButton, createScreen, setScreenShown } from './screen';

/**
 * ポーズメニュー（再開 / フォトモード / すべての設定 / ミッションを中断（ミッション中だけ）/ タイトルへ）。
 * 7-D: 設定は独立した設定画面（settings-screen.ts）に移し、ここには「画質・音量・操作補助・HUD」の 4 つだけを quick に出す
 * （部品は設定画面から貸し出される）。「すべての設定」で設定画面へ（飛行は止まったまま。戻るとこのメニューに戻る）
 */
export class PauseMenu {
  readonly root: HTMLDivElement;
  /** 4 つの設定を置く場所（設定画面が部品を貸す） */
  readonly quick: HTMLDivElement;
  /** 練習場（9-5）の設定の欄を置く場所（練習場のときだけ中身が入る） */
  readonly extra: HTMLDivElement;
  private readonly abortButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly photoButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly tiltButton: HTMLButtonElement;
  /** 「フォトモード」（7-A。main がつなぐ） */
  onPhoto: (() => void) | null = null;
  /** 「傾きを合わせ直す」（9-4。傾き操作のときだけ出す） */
  onTiltLevel: (() => void) | null = null;
  /** 「やり直す」（9-5。練習場のときだけ出す） */
  onRestart: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    handlers: {
      onResume: () => void;
      onTitle: () => void;
      onAbort: () => void;
      onSettings: () => void;
    },
  ) {
    const root = createScreen(parent, 'pause-screen');
    const panel = document.createElement('div');
    panel.className = 'ui-panel pause-panel';
    const heading = document.createElement('h2');
    heading.className = 'ui-heading pause-heading';
    heading.textContent = t('pause.heading');
    const body = document.createElement('div');
    body.className = 'pause-body';
    const actions = document.createElement('div');
    actions.className = 'pause-actions';
    this.quick = document.createElement('div');
    this.quick.className = 'settings-grid pause-quick';
    this.extra = document.createElement('div');
    this.extra.className = 'pause-extra';
    this.extra.hidden = true;
    body.append(actions, this.quick, this.extra);
    panel.append(heading, body);
    root.appendChild(panel);

    this.resumeButton = createButton(
      actions,
      'ui-button is-primary',
      t('pause.resume'),
      handlers.onResume,
    );
    // 9-5: 練習場は同じ課題をすぐ始め直せる
    this.restartButton = createButton(actions, 'ui-button', t('pause.restart'), () => {
      this.onRestart?.();
    });
    this.restartButton.hidden = true;
    // フリーフライト・キャンペーン・ソロのレイドだけ出す（7-A）
    this.photoButton = createButton(actions, 'ui-button', t('pause.photoMode'), () => {
      this.onPhoto?.();
    });
    this.photoButton.hidden = true;
    // 9-4: 傾き操作のときだけ。今の持ち方を中立にする
    this.tiltButton = createButton(actions, 'ui-button', t('pause.tiltLevel'), () => {
      this.onTiltLevel?.();
    });
    this.tiltButton.hidden = true;
    createButton(actions, 'ui-button', t('pause.allSettings'), handlers.onSettings);
    // ミッション中だけ出す（2-4）
    this.abortButton = createButton(
      actions,
      'ui-button is-danger pause-title',
      t('pause.abortMission'),
      handlers.onAbort,
    );
    this.abortButton.hidden = true;
    createButton(actions, 'ui-button is-danger pause-title', t('pause.toTitle'), handlers.onTitle);
    this.root = root;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
  }

  /** 設定画面から戻ったとき: キーボードでも続けられるよう「再開」にフォーカス */
  focusResume(): void {
    this.resumeButton.focus({ preventScroll: true });
  }

  /** ミッション中か（「ミッションを中断」を出す）。label はチュートリアル（4-11）の「チュートリアルを中断」 */
  setInMission(inMission: boolean, label = t('pause.abortMission')): void {
    this.abortButton.hidden = !inMission;
    this.abortButton.textContent = label;
  }

  /** 「やり直す」と設定の欄（extra）を出すか（9-5。練習場） */
  setPracticeAvailable(available: boolean): void {
    this.restartButton.hidden = !available;
    this.extra.hidden = !available;
  }

  /** 「傾きを合わせ直す」を出すか（9-4） */
  setTiltLevelAvailable(available: boolean): void {
    this.tiltButton.hidden = !available;
  }

  /** 「フォトモード」を出すか（PvP・協力・チュートリアルでは出さない） */
  setPhotoAvailable(available: boolean): void {
    this.photoButton.hidden = !available;
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
  button.setAttribute('aria-label', t('pause.heading'));
  const vars: Record<string, string> = {
    '--pause-size': `${c.size}px`,
    '--pause-margin': `${TOUCH_CONFIG.edgeMargin}px`,
    // ヨーボタンと上下中央をそろえ、横に gap 空ける。ヨーボタンは操作設定の大きさ（--tc-scale。4-11）が掛かる
    '--pause-top': `calc(${yaw.top - c.size / 2}px + ${yaw.size / 2}px * var(--tc-scale, 1))`,
    '--pause-touch-right': `calc(${TOUCH_CONFIG.edgeMargin + c.gap}px + ${yaw.size}px * var(--tc-scale, 1))`,
  };
  for (const [name, value] of Object.entries(vars)) button.style.setProperty(name, value);
  return button;
}

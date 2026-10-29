import './mobile.css';
import { TOUCH_MODES, TOUCH_MODE_LABELS, type TouchMode } from '../data/touch';
import { isTouchMode } from '../core/touch-settings';

/** タッチ操作の表示設定（自動 / 表示 / 非表示） */
export function createTouchModeSelect(
  parent: HTMLElement,
  initial: TouchMode,
  onSelect: (mode: TouchMode) => void,
): HTMLSelectElement {
  const label = document.createElement('label');
  label.className = 'settings-item';
  label.textContent = 'タッチ ';
  const select = document.createElement('select');
  for (const mode of TOUCH_MODES) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = TOUCH_MODE_LABELS[mode];
    select.appendChild(option);
  }
  select.value = initial;
  select.addEventListener('change', () => {
    if (isTouchMode(select.value)) onSelect(select.value);
    select.blur();
  });
  label.appendChild(select);
  parent.appendChild(label);
  return select;
}

/** 設定の ON/OFF ボタン（HUD 表示など）。押すたびに onToggle を呼び、返り値の状態を表示する */
export function createToggleButton(
  parent: HTMLElement,
  label: string,
  initial: boolean,
  onToggle: () => boolean,
): { button: HTMLButtonElement; sync: (on: boolean) => void } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-item settings-button';
  const sync = (on: boolean): void => {
    button.textContent = `${label} ${on ? 'ON' : 'OFF'}`;
    button.setAttribute('aria-pressed', String(on));
  };
  sync(initial);
  button.addEventListener('click', () => {
    button.blur();
    sync(onToggle());
  });
  parent.appendChild(button);
  return { button, sync };
}

// iPad の Safari は webkit 接頭辞つきの API だけを持つ
interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface WebkitElement {
  webkitRequestFullscreen?: () => void;
}
interface LockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>;
}

function fullscreenElement(doc: Document & WebkitDocument): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * 全画面ボタン。Fullscreen API が使えない環境（iPhone の Safari）ではボタンを作らない。
 * Android では全画面にしたあと横向きに固定を試みる（失敗しても無視）
 */
export function createFullscreenButton(parent: HTMLElement): HTMLButtonElement | null {
  const doc: Document & WebkitDocument = document;
  const target: HTMLElement & WebkitElement = document.documentElement;
  const standard = doc.fullscreenEnabled && typeof target.requestFullscreen === 'function';
  const webkit = doc.webkitFullscreenEnabled === true && !!target.webkitRequestFullscreen;
  if (!standard && !webkit) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-item settings-button';
  const refresh = (): void => {
    button.textContent = fullscreenElement(doc) ? '全画面解除' : '全画面';
  };
  refresh();
  button.addEventListener('click', () => {
    button.blur();
    if (fullscreenElement(doc)) {
      if (typeof doc.exitFullscreen === 'function')
        void doc.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (standard) {
      void target
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          const orientation: LockableOrientation = screen.orientation;
          return orientation.lock?.('landscape');
        })
        .catch(() => undefined);
    } else {
      target.webkitRequestFullscreen?.();
    }
  });
  doc.addEventListener('fullscreenchange', refresh);
  doc.addEventListener('webkitfullscreenchange', refresh);
  parent.appendChild(button);
  return button;
}

/** 縦画面のときの「横にしてください」。表示は CSS（タッチ操作中 かつ portrait）で切り替える */
export function createRotateHint(parent: HTMLElement): HTMLDivElement {
  const hint = document.createElement('div');
  hint.className = 'rotate-hint';
  hint.textContent = '画面を横にしてください';
  parent.appendChild(hint);
  return hint;
}

/**
 * ピンチ拡大・ダブルタップ拡大・引っ張り更新・スクロールを止める。
 * 基本は CSS の touch-action: none。iOS Safari は viewport の拡大禁止を無視するため、ジェスチャーも止める
 */
export function installTouchGuards(target: Document): void {
  const prevent = (e: Event): void => {
    e.preventDefault();
  };
  target.addEventListener('gesturestart', prevent);
  target.addEventListener('dblclick', prevent);
  target.addEventListener(
    'touchmove',
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}

// お知らせ（トースト）の共通部品（7-D）: 画面の上中央に積み重ねて出す。ボタンは共通の ui-button（文字は折り返さない）。
// 幅が足りない画面ではボタンを縦 2 段にする（toast.css）。更新・ホーム画面に追加・セーブの初期化・オンライン連携の知らせが使う
import './toast.css';
import { el } from './hud-dom';
import { createButton } from './screen';

export interface ToastAction {
  readonly label: string;
  /** 見た目（既定は ghost） */
  readonly kind?: 'primary' | 'ghost';
  /** 押したとき（省略は閉じるだけ）。押すとトーストは閉じる */
  readonly onClick?: () => void;
}

export interface ToastOptions {
  /** 自動で閉じるまでの秒数（0 以下は閉じない） */
  readonly seconds: number;
  readonly actions?: readonly ToastAction[];
  readonly parent?: HTMLElement;
}

export interface Toast {
  readonly root: HTMLDivElement;
  close(): void;
}

let stack: HTMLDivElement | null = null;

function stackIn(parent: HTMLElement): HTMLDivElement {
  if (stack?.parentElement !== parent) stack = el('div', 'toast-stack', parent);
  return stack;
}

/** お知らせを出す */
export function showToast(text: string, opts: ToastOptions): Toast {
  const root = el('div', 'ui-toast app-toast', stackIn(opts.parent ?? document.body));
  root.setAttribute('role', 'status');
  el('span', 'app-toast-text', root, text);
  let timer = 0;
  const close = (): void => {
    window.clearTimeout(timer);
    root.remove();
  };
  const actions = opts.actions ?? [];
  if (actions.length > 0) {
    const row = el('div', 'app-toast-actions', root);
    for (const a of actions) {
      const cls = a.kind === 'primary' ? 'ui-button is-primary' : 'ui-button is-ghost';
      createButton(row, cls, a.label, () => {
        close();
        a.onClick?.();
      });
    }
  } else root.classList.add('is-passive');
  if (opts.seconds > 0) timer = window.setTimeout(close, opts.seconds * 1000);
  return { root, close };
}

import './app-shell.css';
import { APP_SHELL_CONFIG } from '../data/app';
import { checkInstallHint } from '../core/install-hint';
import { SKIP_WAITING_MESSAGE, watchForUpdate, type WorkerLike } from '../core/sw-update';
import { el } from './hud-dom';
import { createButton } from './screen';

/**
 * アプリとしての体裁（4-10）: Service Worker の登録と「新しいバージョンがあります」、
 * iOS の Safari で 2 回目以降の起動時に 1 度だけ「ホーム画面に追加」の案内。
 * SW は本番ビルドだけ（開発サーバーでは登録しない）
 */
export function installAppShell(parent: HTMLElement): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) registerServiceWorker(parent);
  showInstallHint(parent);
}

function registerServiceWorker(parent: HTMLElement): void {
  const sw = navigator.serviceWorker;
  void sw
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then((registration) => {
      watchForUpdate(
        registration,
        () => sw.controller !== null,
        (worker) => {
          showUpdateToast(parent, worker);
        },
      );
    })
    .catch(() => undefined);
}

/** 更新は次回の起動で入る。「今すぐ更新」で待機中の SW に切り替えて読み込み直す */
function showUpdateToast(parent: HTMLElement, worker: WorkerLike): void {
  const toast = createToast(parent, '新しいバージョンがあります（次回の起動で更新）');
  createButton(toast, 'ui-button is-primary', '今すぐ更新', () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
    worker.postMessage(SKIP_WAITING_MESSAGE);
  });
  closeLater(toast, APP_SHELL_CONFIG.updateToastSeconds);
}

interface NavigatorStandalone {
  standalone?: boolean;
}

function showInstallHint(parent: HTMLElement): void {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  const nav: Navigator & NavigatorStandalone = navigator;
  const standalone =
    nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const env = { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints, standalone };
  if (!checkInstallHint(env, storage)) return;
  const toast = createToast(parent, '共有ボタン →「ホーム画面に追加」で全画面で遊べます');
  closeLater(toast, APP_SHELL_CONFIG.installHint.toastSeconds);
}

function createToast(parent: HTMLElement, text: string): HTMLDivElement {
  const toast = el('div', 'ui-toast app-toast', parent);
  toast.setAttribute('role', 'status');
  el('span', 'app-toast-text', toast, text);
  createButton(toast, 'ui-button is-ghost', '閉じる', () => {
    toast.remove();
  });
  return toast;
}

function closeLater(toast: HTMLElement, seconds: number): void {
  if (seconds > 0)
    window.setTimeout(() => {
      toast.remove();
    }, seconds * 1000);
}

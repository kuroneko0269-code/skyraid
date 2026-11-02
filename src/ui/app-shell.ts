import { APP_SHELL_CONFIG } from '../data/app';
import { checkInstallHint } from '../core/install-hint';
import { SKIP_WAITING_MESSAGE, watchForUpdate, type WorkerLike } from '../core/sw-update';
import { setLazyToast } from './lazy-load';
import { showToast } from './toast';
import { isStandaloneDisplay } from './standalone';

/**
 * アプリとしての体裁（4-10）: Service Worker の登録と「新しいバージョンがあります」、
 * iOS の Safari で 2 回目以降の起動時に 1 度だけ「ホーム画面に追加」の案内。
 * SW は本番ビルドだけ（開発サーバーでは登録しない）
 */
export function installAppShell(parent: HTMLElement): void {
  // 遅延読み込み（8-2）の「読み込み中…」と失敗のお知らせもトーストで出す
  setLazyToast(showToast);
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
  showToast('新しいバージョンがあります（次回の起動で更新）', {
    parent,
    seconds: APP_SHELL_CONFIG.updateToastSeconds,
    actions: [
      {
        label: '今すぐ更新',
        kind: 'primary',
        onClick: () => {
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          });
          worker.postMessage(SKIP_WAITING_MESSAGE);
        },
      },
      { label: '閉じる' },
    ],
  });
}

function showInstallHint(parent: HTMLElement): void {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  const env = {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandaloneDisplay(),
  };
  if (!checkInstallHint(env, storage)) return;
  showToast('共有ボタン →「ホーム画面に追加」で全画面で遊べます', {
    parent,
    seconds: APP_SHELL_CONFIG.installHint.toastSeconds,
    actions: [{ label: '閉じる' }],
  });
}

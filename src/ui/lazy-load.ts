// 遅延読み込み（8-2）の表示: 読み込みが長いときの「読み込み中…」と、失敗したときのお知らせ（オフライン / 新しい版の公開直後で
// 古いチャンクが無い）。失敗しても今の画面のまま（ゲームは続けられる）。読み込みの土台は core/lazy-chunk.ts
import { APP_SHELL_CONFIG } from '../data/app';
import { loadWithStatus, type ChunkFailure } from '../core/lazy-chunk';
import type { Toast, ToastOptions } from './toast';

/**
 * お知らせを出す部品（app-shell.ts が起動時に渡す: setLazyToast）。toast.ts（toast.css）をここで import しないのは、
 * 起動時の CSS の並び（7-D まで）を変えないため。渡される前は出さない
 */
let showToast: ((text: string, opts: ToastOptions) => Toast) | null = null;

export function setLazyToast(fn: (text: string, opts: ToastOptions) => Toast): void {
  showToast = fn;
}

function toast(text: string, opts: ToastOptions): Toast | null {
  return showToast ? showToast(text, opts) : null;
}

/**
 * 失敗のお知らせ。ブラウザ（Chrome など）は読めなかったチャンクを覚えていて、通信が戻っても再読み込みするまで読み直さないので、
 * どちらも再読み込みを勧める（オフラインのまま再読み込みすると、SW が入っていなければページが開けないので、通信が戻ってから）
 */
export const CHUNK_FAILURE_TEXT: Record<ChunkFailure, string> = {
  offline: 'オフラインのため読み込めませんでした。通信できるところで再読み込みしてください',
  stale: '読み込めませんでした。新しいバージョンが公開された可能性があります（再読み込みで最新にします）',
};

/** 読み込み中の表示と失敗のお知らせ付きで読む。失敗したら null */
export function loadChunk<T>(chunk: () => Promise<T>): Promise<T | null> {
  let loading: Toast | null = null;
  return loadWithStatus(chunk, {
    delayMs: APP_SHELL_CONFIG.lazyIndicatorDelayMs,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => {
      window.clearTimeout(typeof id === 'number' ? id : undefined);
    },
    online: () => navigator.onLine,
    slow: () => {
      loading = toast('読み込み中…', { seconds: 0 });
    },
    done: () => {
      loading?.close();
      loading = null;
    },
    failed: (why) => {
      toast(CHUNK_FAILURE_TEXT[why], {
        seconds: APP_SHELL_CONFIG.lazyErrorToastSeconds,
        actions: [
          {
            label: '再読み込み',
            kind: why === 'stale' ? 'primary' : 'ghost',
            onClick: () => {
              window.location.reload();
            },
          },
          { label: '閉じる', kind: why === 'stale' ? 'ghost' : 'primary' },
        ],
      });
    },
  });
}

/** 先読み（表示なし。失敗しても何もしない。使うときに loadChunk でやり直す） */
export function prefetchChunk(chunk: () => Promise<unknown>): void {
  chunk().catch(() => undefined);
}

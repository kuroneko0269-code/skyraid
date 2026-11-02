// 画面の大きさの表示（8-6d）の出し方: URL の ?debug=viewport か、タイトルの版の表示を 5 回押す（ホーム画面のアプリ用。
// ホーム画面のアプリは URL を変えられず、iOS は Safari と保存領域が別なので、アプリの中で切り替えて端末に保存する）。
// 表示は遅延チャンク（viewport-debug.ts）
import { parseViewportDebug } from '../core/debug-flags';
import { VIEWPORT_CONFIG } from '../data/app';

const { tapCount, tapWindowMs, storageKey } = VIEWPORT_CONFIG.debugToggle;

function saved(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

function save(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(storageKey, '1');
    else window.localStorage.removeItem(storageKey);
  } catch {
    // 保存できない環境では今回だけ
  }
}

let hide: (() => void) | null = null;

async function show(): Promise<void> {
  if (hide) return;
  const m = await import('./viewport-debug');
  hide = m.showViewportDebug();
}

/** 起動時に呼ぶ（main.ts）。version はタイトルの版の表示（無ければ URL と保存だけ） */
export function installViewportDebug(version: Element | null): void {
  if (parseViewportDebug(window.location.search) || saved()) void show();
  if (!version) return;
  let taps: number[] = [];
  version.addEventListener('click', (e) => {
    // 版の表示を押してもタイトルを進めない（5 回押す間に始まらないように）
    e.stopPropagation();
    const now = performance.now();
    taps = [...taps.filter((t) => now - t < tapWindowMs), now];
    if (taps.length < tapCount) return;
    taps = [];
    if (hide) {
      hide();
      hide = null;
      save(false);
    } else {
      save(true);
      void show();
    }
  });
}

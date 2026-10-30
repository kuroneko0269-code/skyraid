import './save.css';
import { getBrowserStorage } from '../core/settings';
import { SAVE_CONFIG } from '../data/save';
import { SaveStore } from '../progression/save-store';
import { el } from './hud-dom';

/**
 * どの画面でも見えるお知らせを seconds 秒出す（3-1: セーブデータの初期化）。起動直後のタイトルでは HUD が
 * 隠れているので、HUD のお知らせと同じ見た目の別の要素にする
 */
export function showToast(parent: HTMLElement, text: string, seconds: number): void {
  const toast = el('div', 'save-toast', parent, text);
  toast.setAttribute('role', 'status');
  setTimeout(() => {
    toast.remove();
  }, seconds * 1000);
}

/** ブラウザの localStorage からセーブを開く。壊れていて初期値に戻したときはお知らせを出す（3-1） */
export function openBrowserSave(parent: HTMLElement): SaveStore {
  const { store, status } = SaveStore.open(getBrowserStorage());
  if (status === 'reset') showToast(parent, SAVE_CONFIG.resetNotice, SAVE_CONFIG.noticeSeconds);
  return store;
}

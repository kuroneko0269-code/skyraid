import './save.css';
import { t } from '../core/i18n';
import { getBrowserStorage } from '../core/settings';
import { COMPAT_CONFIG } from '../data/compat';
import { SAVE_CONFIG } from '../data/save';
import { SaveStore } from '../progression/save-store';
import { showToast as showCommonToast } from './toast';

/** どの画面でも見えるお知らせを seconds 秒出す（3-1: セーブデータの初期化。7-D から共通のトースト） */
export function showToast(parent: HTMLElement, text: string, seconds: number): void {
  showCommonToast(text, { parent, seconds });
}

/** ブラウザの localStorage からセーブを開く。壊れていて初期値に戻したときはお知らせを出す（3-1） */
export function openBrowserSave(parent: HTMLElement): SaveStore {
  const { store, status } = SaveStore.open(getBrowserStorage());
  if (status === 'reset') showToast(parent, SAVE_CONFIG.resetNotice, SAVE_CONFIG.noticeSeconds);
  // 9-6a の事前修正: 新しい版のセーブは消さずに残す（このまま遊べるが保存しない）
  if (status === 'tooNew') {
    showCommonToast(SAVE_CONFIG.tooNewNotice, {
      parent,
      seconds: SAVE_CONFIG.tooNewNoticeSeconds,
      actions: [{ label: t('save.close') }],
    });
  }
  // 8-3: 保存できない環境（localStorage が使えない・容量超過）でも遊べる。そのことを 1 回だけ知らせる
  store.onWriteFail(() => {
    showCommonToast(COMPAT_CONFIG.storageNotice, {
      parent,
      seconds: COMPAT_CONFIG.storageNoticeSeconds,
      actions: [{ label: t('save.close') }],
    });
  });
  return store;
}

// 起動時の表示言語の読み出し（8-4）: 文言の表は画面より先に読み込むので、セーブ全体を開く前に設定の language だけを読む。
// 壊れていても例外にしない（null = ブラウザの言語に従う）。Three.js・DOM 非依存
import { isLocale, type Locale } from '../core/locale';
import { SAVE_CONFIG } from '../data/save';

export function readSavedLanguage(storage: Pick<Storage, 'getItem'> | null): Locale | null {
  try {
    const text = storage?.getItem(SAVE_CONFIG.storageKey);
    if (!text) return null;
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || !('settings' in data)) return null;
    const settings: unknown = data.settings;
    if (typeof settings !== 'object' || settings === null || !('language' in settings)) return null;
    return isLocale(settings.language) ? settings.language : null;
  } catch {
    return null;
  }
}

// テストで表示言語を切り替える（8-4）
import { setMessages, type MessageTree } from '../src/core/i18n';
import type { Locale } from '../src/core/locale';
import en from '../src/data/i18n/en.json';
import ja from '../src/data/i18n/ja.json';

export function tableFor(locale: Locale): MessageTree {
  return locale === 'en' ? en : ja;
}

export function useLocale(locale: Locale): void {
  setMessages(locale, tableFor(locale));
}

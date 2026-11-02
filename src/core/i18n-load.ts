// 起動時の文言の読み込み（8-4）: 今の言語の表（src/data/i18n/<言語>.json）だけを読み込む（別チャンク。もう一方は読まない）。
// <html lang> と meta description も言語に合わせる
import { setMessages, t, type MessageTree } from './i18n';
import type { Locale } from './locale';

async function importTable(locale: Locale): Promise<MessageTree> {
  const mod = locale === 'en' ? await import('../data/i18n/en.json') : await import('../data/i18n/ja.json');
  return mod.default;
}

export async function loadLocale(locale: Locale, doc: Document = document): Promise<void> {
  setMessages(locale, await importTable(locale));
  doc.documentElement.lang = locale;
  doc.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
}

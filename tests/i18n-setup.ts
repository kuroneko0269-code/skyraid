// テストの準備（8-4）: 文言の表を日本語で読み込む（既存のテストは日本語の表示を確かめている）。英語は useLocale('en')
import { afterEach } from 'vitest';
import { useLocale } from './i18n-helpers';

useLocale('ja');
afterEach(() => {
  useLocale('ja');
});

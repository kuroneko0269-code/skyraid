// 9-6b: ネフィルガ（?dev=kaiju2 の裏だけ）の文言（日本語・英語）。表は src/data/i18n/kaiju2/{ja,en}.json で、遅延チャンクだけが読むので
// 起動時の表（src/data/i18n/{ja,en}.json）には入れない。遊ぶ人に出すとき（9-6c 以降）に起動時の表へ移す。
// キーは両方の言語でそろえる（tests/kaiju2-raid.test.ts）
import { fill, getLocale, type Params } from '../core/i18n';
import en from './i18n/kaiju2/en.json';
import ja from './i18n/kaiju2/ja.json';

type Table = Readonly<Record<string, string | readonly string[]>>;

export const KAIJU2_TEXT: Readonly<Record<'ja' | 'en', Table>> = { ja, en };

function table(): Table {
  return getLocale() === 'en' ? en : ja;
}

/** 文（今の言語。無ければキー） */
export function k2t(key: string, params?: Params): string {
  const v = table()[key];
  return typeof v === 'string' ? fill(v, params) : key;
}

/** 文の配列（ブリーフィング） */
export function k2list(key: string): readonly string[] {
  const v = table()[key];
  return typeof v === 'string' || v === undefined ? [] : v;
}

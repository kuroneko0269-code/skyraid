// 9-6b: ネフィルガの文言（HUD・ブリーフィング・お知らせ・部位の名前。日本語・英語）。表は src/data/i18n/kaiju2/{ja,en}.json で、
// 遅延チャンク（と協力のチャンク）だけが読む。9-6c: 起動時に要る名前・題（モード選択・リプレイ・記録カード）だけを起動時の表
// （src/data/i18n/{ja,en}.json の kaiju2）へ移した。
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

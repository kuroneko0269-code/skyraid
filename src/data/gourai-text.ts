// 10-4b: メカ怪獣ゴウライの文言（HUD・ブリーフィング・お知らせ・部位の名前。日本語・英語）。表は src/data/i18n/gourai/{ja,en}.json で、
// 遅延チャンク（gourai-runtime）だけが読む。起動時に要る名前・題（怪獣選び・リプレイ・記録カード）は起動時の表の gourai。
// キーは両方の言語でそろえる（tests/gourai-raid.test.ts）
import { fill, getLocale, type Params } from '../core/i18n';
import en from './i18n/gourai/en.json';
import ja from './i18n/gourai/ja.json';

type Table = Readonly<Record<string, string | readonly string[]>>;

export const GOURAI_TEXT: Readonly<Record<'ja' | 'en', Table>> = { ja, en };

function table(): Table {
  return getLocale() === 'en' ? en : ja;
}

/** 文（今の言語。無ければキー） */
export function grt(key: string, params?: Params): string {
  const v = table()[key];
  return typeof v === 'string' ? fill(v, params) : key;
}

/** 文の配列（ブリーフィング） */
export function grlist(key: string): readonly string[] {
  const v = table()[key];
  return typeof v === 'string' || v === undefined ? [] : v;
}

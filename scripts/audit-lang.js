/* global process, URL */
// 点検の表示言語（8-4）: `--lang ja|en`（既定 ja）。ブラウザの言語（context の locale）で選ぶ（初回起動の判定もそのまま確かめる）。
// 画面の文字で要素を探すところは L('日本語') で今の言語の文に置き換える（src/data/i18n の ja.json と en.json を同じキーで対応させる）
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--lang');
/** 点検の言語 */
export const AUDIT_LANG = i >= 0 && argv[i + 1] === 'en' ? 'en' : 'ja';
/** browser.newContext の locale（navigator.languages の先頭になる） */
export const CONTEXT_LOCALE = AUDIT_LANG === 'en' ? 'en-US' : 'ja-JP';

const read = (lang) =>
  JSON.parse(readFileSync(new URL(`../src/data/i18n/${lang}.json`, import.meta.url), 'utf8'));

/** 葉（文字列・配列の各要素）を キー → 文 に */
function flatten(tree, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (Array.isArray(v)) v.forEach((s, n) => out.set(`${key}.${n}`, s));
    else flatten(v, key, out);
  }
  return out;
}

const JA = flatten(read('ja'));
const EN = flatten(read('en'));

/**
 * 画面の日本語の文を今の点検の言語の文に。同じ日本語が複数のキーにあるときは最初のもの（keyHint でキーの一部を指定できる）
 */
export function L(text, keyHint) {
  if (AUDIT_LANG === 'ja') return text;
  for (const [key, ja] of JA) {
    if (ja !== text || (keyHint && !key.includes(keyHint))) continue;
    const en = EN.get(key);
    if (en !== undefined) return en;
  }
  throw new Error(`audit-lang: no translation for "${text}"${keyHint ? ` (${keyHint})` : ''}`);
}

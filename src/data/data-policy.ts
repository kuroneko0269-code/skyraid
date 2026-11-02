// 情報画面の「データの扱い」の文面（7-D。8-1 で見直し: オンライン連携で送る個人の情報はメールと表示名だけ・P2P は相手に IP が見える）
// 文面は文言の表（dataPolicy.*。8-4）。表は起動後に読むので、各行の見出しと本文は読むときに引く
import { t } from '../core/i18n';

/** 見出しと本文の組。要素を読んだときに表から引く（分割代入・map でもそのまま使える） */
function entry(id: string): readonly [string, string] {
  const pair: [string, string] = ['', ''];
  Object.defineProperty(pair, 0, { get: () => t(`dataPolicy.${id}.title`), enumerable: true });
  Object.defineProperty(pair, 1, { get: () => t(`dataPolicy.${id}.body`), enumerable: true });
  return pair;
}

/** データの扱い（セーブはブラウザ内、オンライン連携は任意でメールと表示名だけ、P2P は相手に IP が見える。8-1 で見直し） */
export const DATA_POLICY: readonly (readonly [string, string])[] = [
  entry('save'),
  entry('online'),
  entry('p2p'),
  entry('fonts'),
  entry('ads'),
];

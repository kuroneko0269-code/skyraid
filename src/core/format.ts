// 数値・日付の書式（8-4）: Intl で今の表示言語に合わせる。書式のオブジェクトは言語と設定ごとに使い回す。DOM 非依存
import { getLocale, localeTag } from './i18n';

const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

function numberFormat(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${getLocale()}|${JSON.stringify(opts)}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeTag(), opts);
    numberCache.set(key, f);
  }
  return f;
}

function dateFormat(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${getLocale()}|${JSON.stringify(opts)}`;
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(localeTag(), opts);
    dateCache.set(key, f);
  }
  return f;
}

/** 数（3 桁区切り）。digits は小数の桁数（省略は整数に丸めず Intl の既定: 最大 3 桁） */
export function formatNumber(n: number, digits?: number): string {
  return numberFormat(
    digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits },
  ).format(n);
}

/** 整数（四捨五入して 3 桁区切り） */
export function formatInteger(n: number): string {
  return numberFormat({ maximumFractionDigits: 0 }).format(Math.round(n));
}

/** クレジット「1,500 CR」 */
export function formatCredits(n: number): string {
  return `${formatInteger(n)} CR`;
}

/** 割合（0〜1 → 「42%」） */
export function formatPercent(ratio: number): string {
  return numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

function toDate(d: Date | number | string): Date {
  return d instanceof Date ? d : new Date(d);
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
const TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/** 日付（ja「2026/11/02」・en「11/02/2026」）。不正な日付は「—」 */
export function formatDate(d: Date | number | string): string {
  const date = toDate(d);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat(DATE_OPTS).format(date);
}

/** 日時（ja「2026/11/02 13:05」・en「11/02/2026, 13:05」）。不正な日付は「—」 */
export function formatDateTime(d: Date | number | string): string {
  const date = toDate(d);
  return Number.isNaN(date.getTime())
    ? '—'
    : dateFormat({ ...DATE_OPTS, ...TIME_OPTS }).format(date);
}

/** 時刻（「13:05」） */
export function formatTimeOfDay(d: Date | number | string): string {
  const date = toDate(d);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat(TIME_OPTS).format(date);
}

/** 並べ替え用の比較（名前など。今の言語の照合順序） */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, localeTag());
}

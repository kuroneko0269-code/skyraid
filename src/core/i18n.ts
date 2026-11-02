// 文言の表（8-4）: src/data/i18n/{ja,en}.json を言語ごとに 1 つだけ読み込み、キー（"hangar.title" のような点区切り）で引く。
// i18n ライブラリは使わない。起動時（main.ts）に loadLocale で今の言語の表を読み込んでから画面を作る。
// モジュールの最上位（import の時点）では t() を呼ばないこと（表を読み込む前に評価されるため）。定数の表は関数にする。
// 文中の {name} は params で置き換える。複数形は { "one": …, "other": … } の形のキーを tn() で引く（Intl.PluralRules）
import type { Locale } from './locale';

/** JSON の木（文字列・文字列の配列・入れ子） */
export interface MessageTree {
  readonly [key: string]: string | readonly string[] | MessageTree;
}

export type Params = Readonly<Record<string, string | number>>;

let currentLocale: Locale = 'ja';
let table: MessageTree | null = null;
const missing = new Set<string>();

/** 表を差し替える（起動時の loadLocale・テストの準備） */
export function setMessages(locale: Locale, messages: MessageTree): void {
  currentLocale = locale;
  table = messages;
  plural = null;
}

/** 今の表示言語 */
export function getLocale(): Locale {
  return currentLocale;
}

/** BCP 47 の言語タグ（Intl に渡す） */
export function localeTag(locale: Locale = currentLocale): string {
  return locale === 'ja' ? 'ja-JP' : 'en-US';
}

function lookup(key: string): string | readonly string[] | MessageTree | undefined {
  let node: string | readonly string[] | MessageTree | undefined = table ?? undefined;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string' || isArray(node)) return undefined;
    node = node[part];
  }
  return node;
}

function isArray(v: unknown): v is readonly string[] {
  return Array.isArray(v);
}

function warnMissing(key: string): void {
  if (missing.has(key)) return;
  missing.add(key);
  console.warn(`[i18n] missing key: ${key} (${currentLocale})`);
}

/** {name} を params の値で置き換える（無い名前はそのまま） */
export function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : String(v);
  });
}

/** キーの文。見つからなければキーそのもの（console に 1 回だけ警告） */
export function t(key: string, params?: Params): string {
  const v = lookup(key);
  if (typeof v !== 'string') {
    warnMissing(key);
    return key;
  }
  return fill(v, params);
}

/** キーがあるか（文字列・配列・複数形のどれか） */
export function hasMessage(key: string): boolean {
  return lookup(key) !== undefined;
}

/** 文の配列（ブリーフィングの各行など）。見つからなければ空 */
export function tList(key: string, params?: Params): string[] {
  const v = lookup(key);
  if (!isArray(v)) {
    warnMissing(key);
    return [];
  }
  return v.map((s) => fill(s, params));
}

let plural: Intl.PluralRules | null = null;

/**
 * 数によって形が変わる文。キーは { "one": "{count} wave", "other": "{count} waves" } の形（日本語は other だけでよい）。
 * {count} は今の言語の数の書式（3 桁区切り）で入る
 */
export function tn(key: string, count: number, params?: Params): string {
  const v = lookup(key);
  if (v === undefined || typeof v === 'string' || isArray(v)) {
    if (typeof v === 'string') return fill(v, { count: formatCount(count), ...params });
    warnMissing(key);
    return key;
  }
  plural ??= new Intl.PluralRules(localeTag());
  const form = v[plural.select(count)] ?? v.other;
  if (typeof form !== 'string') {
    warnMissing(`${key}.other`);
    return key;
  }
  return fill(form, { count: formatCount(count), ...params });
}

function formatCount(n: number): string {
  return new Intl.NumberFormat(localeTag()).format(n);
}

/** 入れ子の部分（チュートリアルの文のまとまりなど）。見つからなければ null */
export function messageSubtree(key: string): MessageTree | null {
  const v = lookup(key);
  return v === undefined || typeof v === 'string' || isArray(v) ? null : v;
}

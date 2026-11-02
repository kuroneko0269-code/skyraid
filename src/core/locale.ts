// 表示言語（2-5 / 8-4）。決め方: URL の ?lang=ja|en（開発・点検用）> セーブの設定（settings.language）> ブラウザの言語
// （ja で始まれば日本語、それ以外は英語）。?lang=auto はセーブを無視してブラウザの言語。DOM 非依存の純関数
export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(v: unknown): v is Locale {
  return v === 'ja' || v === 'en';
}

/** ブラウザの言語（navigator.languages の先頭）から。ja で始まれば日本語、ほか（空も含む）は英語 */
export function browserLocale(languages: readonly string[]): Locale {
  const first = languages[0]?.toLowerCase();
  return first?.startsWith('ja') ? 'ja' : 'en';
}

/** URL の ?lang= の指定（ja / en / auto。ほかは null） */
export function localeParam(search: string): Locale | 'auto' | null {
  const p = new URLSearchParams(search).get('lang')?.toLowerCase();
  return isLocale(p) || p === 'auto' ? p : null;
}

/**
 * 今の表示言語。saved はセーブの設定（null は未設定 = ブラウザの言語に従う）
 */
export function detectLocale(
  search: string,
  languages: readonly string[],
  saved: Locale | null = null,
): Locale {
  const param = localeParam(search);
  if (isLocale(param)) return param;
  if (param === 'auto') return browserLocale(languages);
  return saved ?? browserLocale(languages);
}

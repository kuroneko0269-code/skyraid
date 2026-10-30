// 表示言語（2-5）。今はミッションのタイトル・ブリーフィング文だけを切り替える（それ以外の UI は日本語のまま）。
// 他の UI がまだ日本語だけなので、既定は日本語。?lang=en で英語、?lang=auto でブラウザの言語
// （ja で始まれば日本語、それ以外は英語）。UI 全体を訳したら、既定をブラウザの言語に変える
export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function detectLocale(search: string, languages: readonly string[]): Locale {
  const param = new URLSearchParams(search).get('lang')?.toLowerCase();
  if (param === 'ja' || param === 'en') return param;
  if (param !== 'auto') return 'ja';
  const first = languages[0]?.toLowerCase();
  return first === undefined || first.startsWith('ja') ? 'ja' : 'en';
}

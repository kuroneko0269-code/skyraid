// テストで表示言語を切り替える（8-4）
import { setMessages, type MessageTree } from '../src/core/i18n';
import type { Locale } from '../src/core/locale';
import en from '../src/data/i18n/en.json';
import ja from '../src/data/i18n/ja.json';

// 作業中の分割（src/data/i18n/parts/<領域>.<言語>.json）も重ねる（マージ後は空）
const parts = import.meta.glob<{ default: MessageTree }>('../src/data/i18n/parts/*.json', {
  eager: true,
});

function merge(a: MessageTree, b: MessageTree): MessageTree {
  const out: Record<string, MessageTree[string]> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] =
      cur && typeof cur === 'object' && !Array.isArray(cur) && typeof v === 'object' && !Array.isArray(v)
        ? merge(cur as MessageTree, v as MessageTree)
        : v;
  }
  return out;
}

export function tableFor(locale: Locale): MessageTree {
  let t: MessageTree = locale === 'en' ? en : ja;
  for (const [path, mod] of Object.entries(parts)) {
    if (path.endsWith(`.${locale}.json`)) t = merge(t, mod.default);
  }
  return t;
}

export function useLocale(locale: Locale): void {
  setMessages(locale, tableFor(locale));
}

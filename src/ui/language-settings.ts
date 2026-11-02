// 言語の切り替え（8-4。設定の「表示」タブ）: 日本語 / English。選ぶとセーブ（settings.language）に保存し、ページを読み込み直して
// 反映する（画面は起動時に一度だけ作るので、再読み込みなしの切り替えはしない。docs/decisions.md の 8-4）。
// 飛行中（ポーズから開いた設定）は再読み込みで飛行が終わってしまうので切り替えない
import { getLocale, t } from '../core/i18n';
import { isLocale, type Locale } from '../core/locale';
import { el } from './hud-dom';
import { Segmented } from './segmented';

export interface LanguageSettingsDeps {
  readonly setLanguage: (locale: Locale) => void;
  /** ポーズから開いた設定画面（飛行中）なら true */
  readonly inFlight: () => boolean;
  /** 読み込み直す（テストで差し替える） */
  readonly reload?: () => void;
}

/** 言語の選択肢は、どちらの言語でもその言語の名前で出す */
const OPTIONS: readonly { value: Locale; label: string }[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
];

/** 読み込み直す。URL の ?lang= はセーブより優先されるので外す */
function reloadWithoutLangParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('lang');
  window.location.replace(url.toString());
}

export function createLanguageSettings(parent: HTMLElement, deps: LanguageSettingsDeps): Segmented {
  const wrap = el('div', 'language-settings', parent);
  let note: HTMLParagraphElement | null = null;
  const seg = new Segmented(wrap, t('language.label'), OPTIONS, getLocale(), (value) => {
    if (!isLocale(value)) return;
    if (deps.inFlight()) {
      seg.value = getLocale();
      note ??= el('p', 'settings-note', wrap);
      note.textContent = t('language.inFlight');
      return;
    }
    deps.setLanguage(value);
    (deps.reload ?? reloadWithoutLangParam)();
  });
  return seg;
}

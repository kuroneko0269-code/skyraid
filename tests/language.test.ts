// 表示言語の保存と読み出し（8-4）・数値と日付の書式
import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../src/progression/save-settings';
import { readSavedLanguage } from '../src/progression/save-language';
import { createInitialSave, parseSave } from '../src/progression/save';
import { SAVE_CONFIG } from '../src/data/save';
import { formatCredits, formatDate, formatDateTime, formatInteger } from '../src/core/format';
import { useLocale } from './i18n-helpers';

const store = (text: string | null): Pick<Storage, 'getItem'> => ({
  getItem: (k) => (k === SAVE_CONFIG.storageKey ? text : null),
});

describe('セーブの言語（8-4）', () => {
  it('既定は null（ブラウザの言語に従う）。ja / en だけを受け付ける', () => {
    expect(defaultSettings().language).toBeNull();
    expect(normalizeSettings({}).language).toBeNull();
    expect(normalizeSettings({ language: 'en' }).language).toBe('en');
    expect(normalizeSettings({ language: 'ja' }).language).toBe('ja');
    expect(normalizeSettings({ language: 'fr' }).language).toBeNull();
    expect(normalizeSettings({ language: 1 }).language).toBeNull();
  });

  it('版は上げない。language の無い今の版のセーブは null で読み、保存した値は読み直しても残る', () => {
    const save = createInitialSave();
    expect(save.version).toBe(SAVE_CONFIG.version);
    const old = JSON.parse(JSON.stringify(save)) as { settings: Record<string, unknown> };
    delete old.settings.language;
    expect(parseSave(JSON.stringify(old))?.settings.language).toBeNull();
    save.settings.language = 'en';
    expect(parseSave(JSON.stringify(save))?.settings.language).toBe('en');
  });

  it('起動時の読み出しは壊れていても例外にしない', () => {
    const save = createInitialSave();
    save.settings.language = 'en';
    expect(readSavedLanguage(store(JSON.stringify(save)))).toBe('en');
    expect(readSavedLanguage(store(null))).toBeNull();
    expect(readSavedLanguage(store('{broken'))).toBeNull();
    expect(readSavedLanguage(store('{"settings":{"language":"de"}}'))).toBeNull();
    expect(readSavedLanguage(store('null'))).toBeNull();
    expect(readSavedLanguage(null)).toBeNull();
  });
});

describe('書式（8-4）', () => {
  it('数とクレジットは 3 桁区切り（両方の言語）', () => {
    expect(formatCredits(1500)).toBe('1,500 CR');
    expect(formatInteger(1234567.4)).toBe('1,234,567');
    useLocale('en');
    expect(formatCredits(1500)).toBe('1,500 CR');
  });

  it('日付は言語の並び（ja 年/月/日・en 月/日/年、24 時間）', () => {
    const d = new Date(2026, 10, 2, 13, 5);
    expect(formatDate(d)).toBe('2026/11/02');
    expect(formatDateTime(d)).toBe('2026/11/02 13:05');
    useLocale('en');
    expect(formatDate(d)).toBe('11/02/2026');
    expect(formatDateTime(d)).toBe('11/02/2026, 13:05');
    expect(formatDate('not a date')).toBe('—');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPAT_NOTICE, MIN_ENVIRONMENT, MIN_ENVIRONMENT_NOTE } from '../src/data/compat';
import { SAVE_CONFIG } from '../src/data/save';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';

/** 書き込みで容量超過になる localStorage の偽物 */
class FullStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  full = true;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('保存できない環境（8-3）', () => {
  it('localStorage が使えなければ、知らせ先を登録した時点で 1 回だけ知らせる', () => {
    const { store } = SaveStore.open(null);
    let calls = 0;
    store.onWriteFail(() => {
      calls++;
    });
    expect(calls).toBe(1);
    store.setPilotName('ACE');
    store.addCredits(100);
    expect(calls).toBe(1);
    // 遊べる（メモリの中では変わる）
    expect(store.pilotName).toBe('ACE');
    expect(store.credits).toBe(100);
  });

  it('容量超過は最初に書けなかったときに 1 回だけ知らせる', () => {
    const storage = new FullStorage();
    const { store } = SaveStore.open(storage);
    let calls = 0;
    store.onWriteFail(() => {
      calls++;
    });
    expect(calls).toBe(0);
    expect(store.setPilotName('ACE')).toBe('ACE');
    expect(calls).toBe(1);
    store.addCredits(50);
    expect(calls).toBe(1);
    expect(storage.map.has(SAVE_CONFIG.storageKey)).toBe(false);
    // 空きができれば保存は続く（知らせは出し直さない）
    storage.full = false;
    expect(store.persist()).toBe(true);
    expect(storage.map.has(SAVE_CONFIG.storageKey)).toBe(true);
    expect(calls).toBe(1);
  });

  it('書ければ知らせない', () => {
    const storage = new FullStorage();
    storage.full = false;
    const { store } = SaveStore.open(storage);
    let calls = 0;
    store.onWriteFail(() => {
      calls++;
    });
    store.setPilotName('ACE');
    expect(calls).toBe(0);
  });
});

describe('最低動作環境と案内の文（8-3）', () => {
  it('iOS・Android・パソコンの 3 行で、版の数字を含む', () => {
    expect(MIN_ENVIRONMENT.map((m) => m.platform)).toEqual([
      'iPhone / iPad',
      'Android',
      'パソコン',
    ]);
    for (const m of MIN_ENVIRONMENT) expect(m.browser).toMatch(/\d/);
  });

  it('案内はどの問題にも見出しと本文がある', () => {
    for (const k of ['no-webgl', 'no-webgl2', 'start-failed'] as const) {
      expect(COMPAT_NOTICE[k].title.length).toBeGreaterThan(0);
      expect(COMPAT_NOTICE[k].body.length).toBeGreaterThan(0);
    }
  });

  it('古いブラウザの案内（public/legacy-check.js。ES5 で別に書いている）も同じ動作環境を出す', () => {
    const legacy = readFileSync(new URL('../public/legacy-check.js', import.meta.url), 'utf8');
    for (const m of MIN_ENVIRONMENT) expect(legacy).toContain(`${m.platform}: ${m.browser}`);
    expect(legacy).toContain(MIN_ENVIRONMENT_NOTE);
  });
});

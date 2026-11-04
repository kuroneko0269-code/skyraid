// 9-6a の事前修正: このアプリより新しい版のセーブを初期化しない（消さずに残し、自動の保存では書かない）
import { describe, expect, it } from 'vitest';
import { SAVE_CONFIG } from '../src/data/save';
import { createInitialSave, isNewerSave } from '../src/progression/save';
import { SaveStore, encodeSave, type SaveStorage } from '../src/progression/save-store';

class FakeStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const KEY = SAVE_CONFIG.storageKey;

describe('新しい版のセーブ', () => {
  it('版が新しいだけを見分ける（壊れた JSON・今の版・古い版は false）', () => {
    expect(isNewerSave(JSON.stringify({ version: SAVE_CONFIG.version + 1 }))).toBe(true);
    expect(isNewerSave(JSON.stringify({ version: SAVE_CONFIG.version }))).toBe(false);
    expect(isNewerSave(JSON.stringify({ version: 1 }))).toBe(false);
    expect(isNewerSave('{oops')).toBe(false);
    expect(isNewerSave(JSON.stringify({ version: '99' }))).toBe(false);
  });

  it('知らない（新しい）版は消さずに残す（status tooNew）。自動の保存では書かず、復元・削除で解ける', () => {
    const newer = JSON.stringify({
      ...createInitialSave(),
      version: SAVE_CONFIG.version + 1,
      credits: 777,
    });
    const storage = new FakeStorage();
    storage.map.set(KEY, newer);
    const { store, status } = SaveStore.open(storage);
    expect(status).toBe('tooNew');
    expect(store.isLocked).toBe(true);
    // 遊べる（初期値）が、設定・報酬・クラウドの受け取りでは書かない
    let persisted = 0;
    store.onPersist(() => persisted++);
    store.addCredits(500);
    store.setSetting('hud', false);
    store.settingsStorage.setItem('skyraid.quality', 'low');
    expect(store.replaceWith(createInitialSave())).toBe(false);
    expect(persisted).toBe(0);
    expect(storage.map.get(KEY)).toBe(newer);
    // 次に開いても同じ（古い版のアプリを何度開いても残る）
    expect(SaveStore.open(storage).status).toBe('tooNew');
    expect(storage.map.get(KEY)).toBe(newer);
    // 遊ぶ人がはっきり選んだ復元は書く
    expect(store.importString(encodeSave({ ...createInitialSave(), credits: 42 }))).toBe(true);
    expect(store.isLocked).toBe(false);
    expect(SaveStore.open(storage).store.credits).toBe(42);
  });

  it('知らない版のセーブの削除は消して初期値から（ロックを解く）', () => {
    const storage = new FakeStorage();
    storage.map.set(KEY, JSON.stringify({ ...createInitialSave(), version: 99 }));
    const { store } = SaveStore.open(storage);
    store.clear();
    expect(store.isLocked).toBe(false);
    expect(storage.map.has(KEY)).toBe(false);
    store.addCredits(10);
    expect(SaveStore.open(storage).status).toBe('loaded');
  });
});

// 難易度と操作補助の設定（4-12）: 難易度の数値・フリーフライトの初期値・セーブ v4 の操作補助
import { describe, expect, it } from 'vitest';
import { loadAssistSettings, saveAssistSetting } from '../src/core/assist-settings';
import { DIFFICULTIES, DIFFICULTY_PRESETS, FREE_FLIGHT_ENEMIES } from '../src/data/ai';
import { ASSIST_SETTINGS_KEYS } from '../src/data/assist';
import { TRAINING_MISSION } from '../src/data/missions';
import { SAVE_CONFIG } from '../src/data/save';
import { GUN_CONFIG } from '../src/data/weapons';
import { createInitialSave, migrateSave } from '../src/progression/save';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';

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

describe('難易度（4-12）', () => {
  it('4-12: easy を緩め（maxG 11・ミサイル 0.04・反応 1.0 秒）、rookie は maxG 9・狙いのずれ 2.5°。normal / hard は 2-3 のまま', () => {
    const p = DIFFICULTY_PRESETS;
    expect(DIFFICULTIES).toEqual(['rookie', 'easy', 'normal', 'hard']);
    expect([p.easy.maxG, p.easy.missileChance, p.easy.reactionSeconds]).toEqual([11, 0.04, 1]);
    expect([p.rookie.maxG, p.rookie.aimErrorDeg]).toEqual([9, 2.5]);
    expect([p.normal.maxG, p.normal.missileChance, p.normal.reactionSeconds]).toEqual([
      24, 0.2, 0.3,
    ]);
    expect([p.hard.maxG, p.hard.missileChance, p.hard.reactionSeconds]).toEqual([30, 0.45, 0.15]);
  });

  it('rookie は easy より弱い: 機銃だけ（ミサイルなし）・引ける G が小さい・狙いが粗い', () => {
    const { rookie, easy } = DIFFICULTY_PRESETS;
    expect(rookie.maxG).toBeLessThan(easy.maxG);
    expect(rookie.aimErrorDeg).toBeGreaterThan(easy.aimErrorDeg);
    expect([rookie.missileChance, rookie.missileAmmo]).toEqual([0, 0]);
  });

  it('フリーフライトの敵の初期値は easy、M1 の敵は rookie。機銃は 1 発 12（敵機 HP 120 を 10 発）', () => {
    expect(FREE_FLIGHT_ENEMIES.defaultDifficulty).toBe('easy');
    const spawn = TRAINING_MISSION.spawns[0];
    expect(spawn?.kind === 'enemyFighter' && spawn.difficulty).toBe('rookie');
    expect(GUN_CONFIG.damage).toBe(12);
    expect(Math.ceil(120 / GUN_CONFIG.damage)).toBe(10);
  });
});

describe('操作補助の設定（スキーマ v4）', () => {
  it('v3 のセーブを v4 に移行すると操作補助が初期値（すべて ON）で入り、難易度など ほかの設定は残る', () => {
    const v4 = createInitialSave();
    const settings: Record<string, unknown> = { ...v4.settings, difficulty: 'hard', hud: false };
    delete settings.assist;
    delete settings.difficultyEased;
    const save = migrateSave({ ...v4, version: 3, settings });
    expect(save?.version).toBe(SAVE_CONFIG.version);
    expect(save?.settings.assist).toEqual({ aim: true, camera: true, hud: true });
    // normal 以外の難易度はそのまま
    expect(save?.settings.difficulty).toBe('hard');
    expect(save?.settings.hud).toBe(false);
  });

  it('4-11 の事前修正: 難易度が normal なら一度だけ easy にし、印を立てて書き戻す。以後 normal に戻しても触らない', () => {
    const storage = new FakeStorage();
    const old = createInitialSave();
    const settings: Record<string, unknown> = { ...old.settings, difficulty: 'normal' };
    delete settings.difficultyEased;
    storage.map.set(KEY, JSON.stringify({ ...old, settings }));
    const store = SaveStore.open(storage).store;
    expect(store.settings.difficulty).toBe('easy');
    expect(store.settings.difficultyEased).toBe(true);
    // 開いた時点で書き戻している（次の起動で同じ直しを繰り返さない）
    const written = JSON.parse(storage.map.get(KEY) ?? '{}') as {
      settings: Record<string, unknown>;
    };
    expect(written.settings.difficulty).toBe('easy');
    expect(written.settings.difficultyEased).toBe(true);
    // プレイヤーが normal に戻したら、そのまま
    store.setSetting('difficulty', 'normal');
    expect(SaveStore.open(storage).store.settings.difficulty).toBe('normal');
    // v3 からの移行でも同じ（印のない normal は easy）
    delete settings.assist;
    expect(migrateSave({ ...old, version: 3, settings })?.settings.difficulty).toBe('easy');
  });

  it('新しいセーブの難易度は easy。設定の部品は古いキー名（skyraid.assist.*）で on / off を読み書きできる', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    expect(store.settings.difficulty).toBe('easy');
    const flags = loadAssistSettings(store.settingsStorage);
    expect(flags).toEqual({ aim: true, camera: true, hud: true });
    saveAssistSetting(store.settingsStorage, 'camera', false);
    store.settingsStorage.setItem(ASSIST_SETTINGS_KEYS.aim, 'maybe');
    const reopened = SaveStore.open(storage).store;
    expect(reopened.settings.assist).toEqual({ aim: true, camera: false, hud: true });
    expect(loadAssistSettings(reopened.settingsStorage).camera).toBe(false);
    // 不正な値は既定値
    const raw = JSON.parse(storage.map.get(KEY) ?? '{}') as { settings: Record<string, unknown> };
    raw.settings.assist = { aim: 'yes', camera: false };
    storage.map.set(KEY, JSON.stringify(raw));
    expect(SaveStore.open(storage).store.settings.assist).toEqual({
      aim: true,
      camera: false,
      hud: true,
    });
  });
});

// フリーフライトの敵の設定（2-3）: 敵の有無と難易度。localStorage に保存する（読めなければ既定値）
import {
  DIFFICULTIES,
  ENEMY_SETTINGS_KEYS,
  FREE_FLIGHT_ENEMIES,
  type Difficulty,
} from '../data/ai';
import type { StorageLike } from './settings';

export interface EnemySettings {
  enabled: boolean;
  difficulty: Difficulty;
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

/** 保存した設定。未保存・不正値・アクセス不可なら「敵あり・normal」 */
export function loadEnemySettings(storage: StorageLike | null): EnemySettings {
  const settings: EnemySettings = {
    enabled: true,
    difficulty: FREE_FLIGHT_ENEMIES.defaultDifficulty,
  };
  if (!storage) return settings;
  try {
    const enabled = storage.getItem(ENEMY_SETTINGS_KEYS.enabled);
    if (enabled === 'off') settings.enabled = false;
    const difficulty = storage.getItem(ENEMY_SETTINGS_KEYS.difficulty);
    if (isDifficulty(difficulty)) settings.difficulty = difficulty;
  } catch {
    // 既定値のまま
  }
  return settings;
}

export function saveEnemySettings(storage: StorageLike | null, settings: EnemySettings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ENEMY_SETTINGS_KEYS.enabled, settings.enabled ? 'on' : 'off');
    storage.setItem(ENEMY_SETTINGS_KEYS.difficulty, settings.difficulty);
    return true;
  } catch {
    return false;
  }
}

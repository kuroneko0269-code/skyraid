// 1-6 / 2-3 の設定の別キー（localStorage）と、セーブの設定の項目の対応（3-1）。save-store.ts が 300 行を超えたので分けた（4-11）。
// 設定の部品は今もこのキー名で読み書きし、SaveStore.settingsStorage がセーブの設定に振り分ける
import { DIFFICULTIES, ENEMY_SETTINGS_KEYS } from '../data/ai';
import { ASSIST_SETTINGS_KEYS, type AssistKind } from '../data/assist';
import { QUALITY_CONFIG, QUALITY_LEVELS } from '../data/quality';
import { TOUCH_CONFIG, TOUCH_MODES } from '../data/touch';
import type { SaveSettings } from './save';

/** 古い設定のキー → セーブの設定の項目。値の文字列は古いキーと同じ */
export interface SettingKey {
  readonly key: string;
  read(s: SaveSettings): string | null;
  /** 正しい値なら書いて true */
  write(s: SaveSettings, value: string): boolean;
}

function oneOf<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
}

export const SETTING_KEYS: readonly SettingKey[] = [
  {
    key: QUALITY_CONFIG.storageKey,
    read: (s) => s.quality,
    write: (s, v) => {
      if (!oneOf(QUALITY_LEVELS, v)) return false;
      s.quality = v;
      return true;
    },
  },
  {
    key: QUALITY_CONFIG.autoDowngrade.storageKey,
    read: (s) => s.qualityAuto,
    write: (s, v) => {
      if (!oneOf(QUALITY_LEVELS, v)) return false;
      s.qualityAuto = v;
      return true;
    },
  },
  {
    key: TOUCH_CONFIG.storageKey,
    read: (s) => s.touchControls,
    write: (s, v) => {
      if (!oneOf(TOUCH_MODES, v)) return false;
      s.touchControls = v;
      return true;
    },
  },
  {
    key: ENEMY_SETTINGS_KEYS.enabled,
    read: (s) => (s.enemies ? 'on' : 'off'),
    write: (s, v) => {
      if (!(v === 'on' || v === 'off')) return false;
      s.enemies = v === 'on';
      return true;
    },
  },
  {
    key: ENEMY_SETTINGS_KEYS.difficulty,
    read: (s) => s.difficulty,
    write: (s, v) => {
      if (!oneOf(DIFFICULTIES, v)) return false;
      s.difficulty = v;
      return true;
    },
  },
  assistKey('aim'),
  assistKey('camera'),
  assistKey('hud'),
];

/** 操作補助（4-12）の ON/OFF。値は 'on' / 'off' */
function assistKey(kind: AssistKind): SettingKey {
  return {
    key: ASSIST_SETTINGS_KEYS[kind],
    read: (s) => (s.assist[kind] ? 'on' : 'off'),
    write: (s, v) => {
      if (!(v === 'on' || v === 'off')) return false;
      s.assist[kind] = v === 'on';
      return true;
    },
  };
}

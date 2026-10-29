import { TOUCH_CONFIG, TOUCH_MODES, type TouchMode } from '../data/touch';
import type { StorageLike } from './settings';

export function isTouchMode(value: unknown): value is TouchMode {
  return typeof value === 'string' && (TOUCH_MODES as readonly string[]).includes(value);
}

/** 保存したタッチ操作の表示設定。未保存・不正値・アクセス不可なら auto */
export function loadTouchMode(storage: StorageLike | null): TouchMode {
  if (!storage) return 'auto';
  try {
    const value = storage.getItem(TOUCH_CONFIG.storageKey);
    return isTouchMode(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTouchMode(storage: StorageLike | null, mode: TouchMode): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TOUCH_CONFIG.storageKey, mode);
    return true;
  } catch {
    return false;
  }
}

/** 仮想コントローラーを表示するか。auto はタッチ端末（pointer: coarse）のときだけ */
export function shouldShowTouchControls(mode: TouchMode, coarsePointer: boolean): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return coarsePointer;
}

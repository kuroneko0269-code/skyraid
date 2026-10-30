// 操作補助の設定（4-12）: エイムアシスト / ターゲットカメラ / HUD 補助の ON/OFF。StorageLike（セーブの設定）に 'on' / 'off' で保存する
import { ASSIST_SETTINGS, ASSIST_SETTINGS_KEYS, type AssistKind } from '../data/assist';
import type { StorageLike } from './settings';

export type AssistFlags = Record<AssistKind, boolean>;

export const ASSIST_KINDS: readonly AssistKind[] = ['aim', 'camera', 'hud'];

/** 保存した設定。未保存・不正値・アクセス不可なら初期値（どれも ON） */
export function loadAssistSettings(storage: StorageLike | null): AssistFlags {
  const flags: AssistFlags = {
    aim: ASSIST_SETTINGS.aim.defaultOn,
    camera: ASSIST_SETTINGS.camera.defaultOn,
    hud: ASSIST_SETTINGS.hud.defaultOn,
  };
  if (!storage) return flags;
  for (const k of ASSIST_KINDS) {
    try {
      const v = storage.getItem(ASSIST_SETTINGS_KEYS[k]);
      if (v === 'on' || v === 'off') flags[k] = v === 'on';
    } catch {
      // 既定値のまま
    }
  }
  return flags;
}

export function saveAssistSetting(
  storage: StorageLike | null,
  kind: AssistKind,
  on: boolean,
): void {
  try {
    storage?.setItem(ASSIST_SETTINGS_KEYS[kind], on ? 'on' : 'off');
  } catch {
    // 保存できなくても今の飛行には効かせる
  }
}

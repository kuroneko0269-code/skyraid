// ポーズメニューの設定「エイムアシスト」「ターゲットカメラ」「HUD 補助」（4-12）。変えたらすぐ保存して効かせる
import {
  ASSIST_KINDS,
  loadAssistSettings,
  saveAssistSetting,
  type AssistFlags,
} from '../core/assist-settings';
import type { StorageLike } from '../core/settings';
import { ASSIST_SETTINGS } from '../data/assist';
import { createToggleButton } from './mobile';

/** 設定を読み、ON/OFF のボタンを panel に置く。返す flags は変更のたびに書き換わる（毎フレーム読む） */
export function createAssistSettings(panel: HTMLElement, storage: StorageLike | null): AssistFlags {
  const flags = loadAssistSettings(storage);
  for (const kind of ASSIST_KINDS) {
    createToggleButton(panel, ASSIST_SETTINGS[kind].label, flags[kind], () => {
      flags[kind] = !flags[kind];
      saveAssistSetting(storage, kind, flags[kind]);
      return flags[kind];
    });
  }
  return flags;
}

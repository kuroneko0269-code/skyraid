// 設定画面の戻り先（7-D。DOM 非依存）。設定画面はタイトル（歯車）・モード選択（「設定」）・ポーズ（「すべての設定」）から開き、
// 「戻る」・Esc で開いた元へ戻る。画面の状態（GameState）は変えずに上へ重ねる: ポーズから開いても状態は pause のままなので、
// 飛行は止まったまま（isSimulating）・カメラと HUD もポーズのまま。戻るとポーズのメニューに戻り、そこから再開できる
import type { ScreenState } from './game-state';

export const SETTINGS_ORIGINS = ['title', 'mode_select', 'pause'] as const;
export type SettingsOrigin = (typeof SETTINGS_ORIGINS)[number];

export function isSettingsOrigin(state: ScreenState): state is SettingsOrigin {
  return (SETTINGS_ORIGINS as readonly ScreenState[]).includes(state);
}

export class SettingsRoute {
  private from: SettingsOrigin | null = null;

  /** 開いた元（閉じていれば null） */
  get origin(): SettingsOrigin | null {
    return this.from;
  }

  get isOpen(): boolean {
    return this.from !== null;
  }

  /** 今の画面から開く。開けない画面・すでに開いているときは false */
  open(state: ScreenState): boolean {
    if (this.from !== null || !isSettingsOrigin(state)) return false;
    this.from = state;
    return true;
  }

  /** 閉じて戻り先を返す（開いていなければ null） */
  close(): SettingsOrigin | null {
    const from = this.from;
    this.from = null;
    return from;
  }

  /**
   * 画面の状態が変わったとき（設定画面を開いたまま別の画面へ移った: 切断・同期のダイアログなど）。
   * 開いた元と違う状態になったら閉じる。閉じたら true
   */
  follow(state: ScreenState): boolean {
    if (this.from === null || this.from === state) return false;
    this.from = null;
    return true;
  }
}

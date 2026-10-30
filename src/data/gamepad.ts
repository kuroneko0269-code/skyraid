// ゲームパッドの割当（Gamepad API の standard マッピング）。docs/spec.md「操作」の表に対応
// ボタン番号: 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start
// 軸番号: 0=左X 1=左Y 2=右X 3=右Y（上・左が負）

import type { Action } from './keybinds';

/** 2軸のスティック。軸ごとに負側・正側のアクションを割り当てる（null は未使用） */
export interface StickBinding {
  readonly xAxis: number;
  readonly yAxis: number;
  readonly left: Action | null;
  readonly right: Action | null;
  readonly up: Action | null;
  readonly down: Action | null;
}

export interface GamepadMapping {
  readonly sticks: readonly StickBinding[];
  /** ボタン番号 → アクション（複数可）。LT/RT のようなアナログボタンは value（0〜1）をそのまま使う */
  readonly buttons: Readonly<Record<number, Action | readonly Action[]>>;
}

export const GAMEPAD_CONFIG = {
  /** スティックのデッドゾーン（半径。0〜1）。外側は 0〜1 に引き伸ばす */
  stickDeadzone: 0.15,
  /** アナログボタン（トリガー）のデッドゾーン */
  buttonDeadzone: 0.05,
} as const;

export const DEFAULT_GAMEPAD_MAPPING: GamepadMapping = {
  sticks: [
    // 左スティック: 前に倒す = 機首下げ（キーボードの W と同じ操縦桿の感覚）
    { xAxis: 0, yAxis: 1, left: 'rollLeft', right: 'rollRight', up: 'pitchDown', down: 'pitchUp' },
    // 右スティック上下: スロットル（倒している間だけ上げ下げ。キーボードの Shift / Z と同じ）
    { xAxis: 2, yAxis: 3, left: null, right: null, up: 'throttleUp', down: 'throttleDown' },
  ],
  buttons: {
    0: 'missile',
    1: 'flare',
    2: 'rocket',
    3: 'targetNext',
    4: 'afterburner',
    5: 'fire',
    6: 'yawLeft',
    // RT はヨー（右）と爆弾の長押し投下を兼ねる（2-6。長押しの判定は src/core/weapon-input.ts）
    7: ['yawRight', 'bombHold'],
    8: 'cameraToggle',
    9: 'pause',
  },
};

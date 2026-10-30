// 操作設定（4-11）の値: ポーズメニューの設定「操作」。初期値は 4-10 までの挙動と同じ。
// 変換は src/core/control-settings.ts、保存はセーブの settings.controls（v5）
import type { Action } from './keybinds';

export const BUTTON_SIZES = ['small', 'medium', 'large'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/** キーボードで割り当てを変えられる主要 12 アクション（設定の並び順） */
export const REMAPPABLE_ACTIONS = [
  'pitchDown',
  'pitchUp',
  'rollLeft',
  'rollRight',
  'yawLeft',
  'yawRight',
  'throttleUp',
  'throttleDown',
  'fire',
  'missile',
  'afterburner',
  'flare',
] as const satisfies readonly Action[];
export type RemappableAction = (typeof REMAPPABLE_ACTIONS)[number];

export const CONTROL_SETTINGS = {
  /** スティック感度: タッチのスティック・パッドの左スティックのピッチ・ロールに掛ける（1 で頭打ち） */
  sensitivity: { min: 0.6, max: 1.6, step: 0.1, default: 1.0 },
  /** タッチのスティックのデッドゾーン（半径に対する比）。初期値は data/touch.ts の 12% */
  deadzone: { min: 0.05, max: 0.25, step: 0.01, default: 0.12 },
  /** タッチのボタン（スロットル・ヨーも）の大きさの倍率。中が 4-10 までの大きさ */
  buttonScale: { small: 0.8, medium: 1, large: 1.2 } satisfies Record<ButtonSize, number>,
  defaultButtonSize: 'medium' satisfies ButtonSize,
  /** 振動（Vibration API）の長さ（ms）。被弾・自機のミサイル発射・撃墜 */
  vibration: { hit: 40, launch: 20, kill: 60 },
  /** 割り当てられないキー（Esc はポーズと割り当ての取り消し） */
  reservedCodes: ['Escape'],
} as const;

/** 設定の表示名 */
export const CONTROL_LABELS = {
  sensitivity: 'スティック感度',
  deadzone: 'デッドゾーン（タッチ）',
  invertPitch: 'ピッチ反転',
  autoLevel: 'オートレベル',
  swapSides: '左右入替（タッチ）',
  vibration: '振動',
  vibrationUnsupported: '振動（Android のみ。この端末は非対応）',
  buttonSize: 'ボタンの大きさ',
  keys: 'キー割当',
  buttonSizes: { small: '小', medium: '中', large: '大' } satisfies Record<ButtonSize, string>,
  actions: {
    pitchDown: '機首下げ',
    pitchUp: '機首上げ',
    rollLeft: '左ロール',
    rollRight: '右ロール',
    yawLeft: '左ヨー',
    yawRight: '右ヨー',
    throttleUp: 'スロットル +',
    throttleDown: 'スロットル −',
    fire: '機銃',
    missile: 'ミサイル',
    afterburner: 'アフターバーナー',
    flare: 'フレア',
  } satisfies Record<RemappableAction, string>,
} as const;

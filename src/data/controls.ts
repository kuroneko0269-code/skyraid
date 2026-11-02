// 操作設定（4-11）の値: ポーズメニューの設定「操作」。初期値は 4-10 までの挙動と同じ。
// 変換は src/core/control-settings.ts、保存はセーブの settings.controls（v5）
import { t } from '../core/i18n';
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
  get sensitivity() {
    return t('controls.sensitivity');
  },
  get deadzone() {
    return t('controls.deadzone');
  },
  get invertPitch() {
    return t('controls.invertPitch');
  },
  get autoLevel() {
    return t('controls.autoLevel');
  },
  get swapSides() {
    return t('controls.swapSides');
  },
  get vibration() {
    return t('controls.vibration');
  },
  get vibrationUnsupported() {
    return t('controls.vibrationUnsupported');
  },
  get buttonSize() {
    return t('controls.buttonSize');
  },
  get keys() {
    return t('controls.keys');
  },
  buttonSizes: {
    get small() {
      return t('controls.buttonSizes.small');
    },
    get medium() {
      return t('controls.buttonSizes.medium');
    },
    get large() {
      return t('controls.buttonSizes.large');
    },
  } satisfies Record<ButtonSize, string>,
  actions: {
    get pitchDown() {
      return t('controls.actions.pitchDown');
    },
    get pitchUp() {
      return t('controls.actions.pitchUp');
    },
    get rollLeft() {
      return t('controls.actions.rollLeft');
    },
    get rollRight() {
      return t('controls.actions.rollRight');
    },
    get yawLeft() {
      return t('controls.actions.yawLeft');
    },
    get yawRight() {
      return t('controls.actions.yawRight');
    },
    get throttleUp() {
      return t('controls.actions.throttleUp');
    },
    get throttleDown() {
      return t('controls.actions.throttleDown');
    },
    get fire() {
      return t('controls.actions.fire');
    },
    get missile() {
      return t('controls.actions.missile');
    },
    get afterburner() {
      return t('controls.actions.afterburner');
    },
    get flare() {
      return t('controls.actions.flare');
    },
  } satisfies Record<RemappableAction, string>,
} as const;

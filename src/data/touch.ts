// タッチ操作（仮想コントローラー）の数値。DOM は src/ui/touch-controls.ts、ロジックは src/core/touch-stick.ts
// 寸法はすべて CSS px。端からの余白には別途 safe-area（ノッチ）を足す

import { t } from '../core/i18n';

export const TOUCH_MODES = ['auto', 'on', 'off'] as const;
export type TouchMode = (typeof TOUCH_MODES)[number];

export const TOUCH_MODE_LABELS: Readonly<Record<TouchMode, string>> = {
  get auto() {
    return t('touch.mode.auto');
  },
  get on() {
    return t('touch.mode.on');
  },
  get off() {
    return t('touch.mode.off');
  },
};

export const TOUCH_CONFIG = {
  /** localStorage のキー（値は auto / on / off） */
  storageKey: 'skyraid.touchControls',
  /** 画面端からの余白 */
  edgeMargin: 16,
  stick: {
    /** スティックを最大まで倒したときの指の移動量 */
    radius: 64,
    /** デッドゾーン（radius に対する比）。外側は 0〜1 に引き伸ばす */
    deadzone: 0.12,
    /** つまみの直径 */
    knobSize: 56,
    /** スティックを出せる範囲: 画面の左からこの比率の幅まで */
    zoneWidthRatio: 0.45,
    /** スティックを出せる範囲: 画面の上からこの比率より下（上端はヨーボタンと ⏸ ボタン用に空ける） */
    zoneTopRatio: 0.25,
  },
  buttons: {
    /** 機銃以外のボタンの一辺（最低 56） */
    size: 64,
    /** 機銃ボタンの一辺（親指の定位置なので大きく） */
    fireSize: 80,
    gap: 12,
    /** スロットルとボタン群の間隔 */
    sliderGap: 20,
  },
  throttle: {
    width: 56,
    /** スライダーの高さ。画面の高さ比（heightRatio）と maxHeight の小さい方 */
    heightRatio: 0.55,
    maxHeight: 240,
    /** 表示の更新はこの差を超えたときだけ（毎フレームの DOM 書き込みを避ける） */
    displayEpsilon: 0.002,
  },
  yaw: {
    size: 56,
    /** 上端からの位置（1-6 まで設定バーがあった高さ。値は変えていない） */
    top: 12,
  },
} as const;

/**
 * メニューのタップの取りこぼし対策（8-6。判定は src/core/tap.ts、DOM は src/ui/tap-rescue.ts）。
 * ブラウザはタップ中に指が少し（Chrome で約 15px、iOS はもっと小さい）動くとクリックを取り消すので、メニューのボタンは
 * 自分でタップを判定する: 動いた距離 slopPx 以内・押していた時間 maxMs 以内・離した点がボタンの上（周り marginPx まで）・
 * スクロールした量 scrollPx 以内ならタップ
 */
export const TAP_CONFIG = {
  slopPx: 24,
  maxMs: 1000,
  marginPx: 8,
  scrollPx: 4,
} as const;

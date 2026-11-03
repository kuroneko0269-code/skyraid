// スティックの改善（9-2）の数値: 操縦の方式（方向へ倒す / ピッチ・ロール）・感度のカーブ・スティックの位置と、
// 「方向へ倒す」方式の組み立て（src/flight/direct-steer.ts）。設定の保存はセーブの settings.controls（src/core/control-settings.ts）
import { t } from '../core/i18n';

/** 操縦の方式（タッチのスティックだけ。キーボード・パッドは今までどおり） */
export const STEER_MODES = ['direct', 'classic'] as const;
export type SteerMode = (typeof STEER_MODES)[number];

/** 感度のカーブ（倒し具合 ^ 指数。1 = 直線 = 9-1 までと同じ） */
export const STICK_CURVES = [1, 1.5, 2] as const;
export type StickCurve = (typeof STICK_CURVES)[number];

/** スティックの位置: floating = 親指を置いた場所に出る（9-1 までと同じ）/ fixed = 決まった位置（左下）に置いたまま */
export const STICK_POSITIONS = ['floating', 'fixed'] as const;
export type StickPosition = (typeof STICK_POSITIONS)[number];

export const STEER_DEFAULTS = {
  mode: 'direct' satisfies SteerMode,
  curve: 1.5 satisfies StickCurve,
  position: 'floating' satisfies StickPosition,
  /** 今の利用者に一度だけ出す「操作方法が新しくなりました」の秒数（タッチ操作を出した最初の飛行の始め） */
  noticeSeconds: 8,
} as const;

/**
 * 「方向へ倒す」方式（9-2）。スティックの向き = 画面の上で行きたい方向（右 = 右へ曲がる・上 = 上がる）。
 * 機首の向きを水平の向き（方位）と上下の角度に分け、倒した分だけずらした向きを「行きたい向き」にして、ロール・引き・ヨーを組み立てる
 */
export const DIRECT_STEER_CONFIG = {
  /** 端まで倒したときに向かわせる、機首からの角度（度。9-1 の模擬と同じ） */
  fullDeg: 30,
  /** 上下の角度の上限（度。宙返りはしない。真上・真下では方位が決まらないため） */
  maxElevationDeg: 80,
  /**
   * 上下に倒していないとき、水平へ戻すずれの上限（度）。旋回で引くと機首が少しずつ上がるのを溜めない。
   * 上下に端まで倒していると 0（戻さない）
   */
  levelDeg: 10,
  /** 行きたい向きと機首のずれ（rad）→ ピッチ・ヨーの入力の倍率（AI の操縦と同じ） */
  pitchGain: 4,
  yawGain: 3,
  /** 角速度（rad/s）で行き過ぎを抑える */
  pitchDamping: 0.3,
  rollDamping: 0.25,
  /** 押す（機首下げ）入力の上限 */
  pushLimit: 0.5,
  /**
   * バンク角の上限（度）。機首を動かしたい向きへ背中を向ける（真横へ曲がるなら 90° で水平旋回。これより浅いと、引き続けると
   * 上がっていく: 75° で約 9° の上昇）。離すと 0（水平）に戻す
   */
  maxBankDeg: 90,
  /** 左右のずれ（度）がこれより小さいとバンクを弱める（機首の近くの細かい合わせはピッチとヨーで） */
  bankFullDeg: 10,
  /** バンク角のずれ（度）→ ロールの入力の倍率 */
  bankGain: 0.03,
  /** 機首の上下（|前方.y|）がこの範囲（ほぼ真上・真下）ではバンク角が決まらないので、バンクを合わせるのを弱める */
  vertical: { rollStart: 0.98, rollEnd: 0.998 },
  /**
   * 低空の安全（9-1 の模擬で低空のリングで地面に当たった件）: 地面・海面（真下と、aheadSeconds 秒先の機首の先の高い方）からの
   * 高さで、行きたい向きの下向きの角度を制限する。clearance m より上は「その下向きから引き起こしても clearance m 残る」角度まで
   * （引き起こしの円弧は速さ / pullRateDeg、効き始めるまで reactSeconds 秒。pullRateDeg は機体の引きの角速度より控えめ:
   * 初期機は 75°/秒 × 速さの係数 0.55〜1）。clearance m を下回ると、下回った割合で climbDeg 度まで上向きにする
   * （離していても引き起こす）
   */
  ground: { clearance: 25, aheadSeconds: 1, pullRateDeg: 40, reactSeconds: 0.4, climbDeg: 15 },
} as const;

/** 設定の表示名 */
export const STEER_LABELS = {
  get mode() {
    return t('controls.steer.mode');
  },
  get curve() {
    return t('controls.steer.curve');
  },
  get position() {
    return t('controls.steer.position');
  },
  modes: {
    get direct() {
      return t('controls.steer.modes.direct');
    },
    get classic() {
      return t('controls.steer.modes.classic');
    },
  } satisfies Record<SteerMode, string>,
  positions: {
    get floating() {
      return t('controls.steer.positions.floating');
    },
    get fixed() {
      return t('controls.steer.positions.fixed');
    },
  } satisfies Record<StickPosition, string>,
} as const;

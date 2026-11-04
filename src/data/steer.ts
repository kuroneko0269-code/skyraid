// スティックの改善（9-2）の数値: 操縦の方式（方向へ倒す / ピッチ・ロール）・感度のカーブ・スティックの位置と、
// 「方向へ倒す」方式の組み立て（src/flight/direct-steer.ts）。設定の保存はセーブの settings.controls（src/core/control-settings.ts）
import { t } from '../core/i18n';

/**
 * 操縦の方式（タッチだけ。キーボード・パッドは今までどおり）。9-4: tilt（端末を傾ける）・drag（行きたい場所を押さえる）は、
 * どちらも「方向へ倒す」の組み立て（direct-steer）に入力を渡す
 */
export const STEER_MODES = ['direct', 'classic', 'tilt', 'drag'] as const;
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
  /** 上下の角度の上限（度。真上・真下では方位が決まらないため。9-3: 上へ端まで倒し続けると宙返りで越える。下は越えない） */
  maxElevationDeg: 80,
  /**
   * 下向きの上限（度。9-4）: 高度に余裕があれば真下まで向けられる（アクロバットのコースの真下向きのリング）。
   * 低空の安全（ground）が先に効くので、余裕が無ければこれより浅い
   */
  maxDiveDeg: 90,
  /**
   * 深く下へ向けるとき（9-4）: 押す（0.5 まで）だけでは機首が下がるのが遅いので、下げたい角度が startDeg を超え、
   * 低空の安全の下限が floorDeg より深い（高度に余裕がある）ときは、背中を下へ向けて（背面へ回して）引く。
   * 下げたい角度が startDeg + rangeDeg で背面まで
   */
  diveRoll: { startDeg: 15, rangeDeg: 12, floorDeg: -70 },
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
  /**
   * 宙返り（9-3。src/flight/loop-steer.ts）: 上へ端まで倒し続けて（stickY ≥ entryStick）上下の角度が entryElevationDeg 以上になると、
   * maxElevationDeg の上限を越えて縦に回る。翼は入ったときの向きのまま水平に保つ（機首は入ったときの方位を含む縦の面の中）。
   * 回る間は stickY ≥ holdStick なら続け、離すと抜ける（頂点付近で離すと、背面から水平に戻って反対向きに飛ぶ = インメルマン）。
   * 1 回転して水平に戻ると抜ける（まだ端まで倒していれば、上がってもう一度回る）
   */
  loop: {
    entryStick: 0.9,
    entryElevationDeg: 75,
    holdStick: 0.5,
    /** 端まで倒したときの輪の半径（m）。holdStick まで戻すと 2 倍（大きな輪） */
    radius: 320,
    /**
     * 失速しない引き: 頂点までの残りの高さで失う速さ（重力の効き × 速度の倍率。エンジンは見込まない）を引いて、
     * 頂点で 失速速度 × topSpeedRatio 以上が残る半径より大きくしない（遅いほど強く引く）
     */
    topSpeedRatio: 1.4,
    /**
     * 入るのに要る速さ: 上の半径で回るのに要る角速度が、機体の引きの角速度（速さで変わる）× entryMargin 以下のとき。
     * 足りなければ今までどおり maxElevationDeg で止まる（HUD に「速度不足」）
     */
    entryMargin: 0.85,
    /** 翼を水平に保つ（ずれの角度 rad → ロールの入力）・面からのずれ → ヨーの入力 */
    rollGain: 3,
    rollDamping: 0.25,
    yawGain: 3,
    /**
     * 離して抜けられる所（度）: 真上 + verticalDeg まで・頂点 ± topDeg・1 回転の手前 pullOutDeg から（背中が上を向いて下っている）。
     * 間で離すと、抜けられる所まで端の輪で回る（真上を過ぎてから離す = インメルマン、下りで離す = 引き起こし）
     */
    release: { verticalDeg: 5, topDeg: 25, pullOutDeg: 60 },
  },
} as const;

/**
 * 傾き操作（9-4。src/core/tilt.ts・src/ui/tilt-source.ts）: 端末の傾き（飛び始めたときの持ち方からの角度）を
 * 「方向へ倒す」のスティックの値にする。左右に傾けると旋回、手前に傾けると上昇・奥へ傾けると下降。
 * デッドゾーン・感度のカーブ・感度はスティックの設定をそのまま使う（デッドゾーンは端の角度に対する比）
 */
export const TILT_CONFIG = {
  /** 端まで倒した扱いになる傾き（度）: 左右・手前と奥 */
  fullRollDeg: 25,
  fullPitchDeg: 25,
  /** センサーの値のなめらかさ（秒。指数の平滑の時定数） */
  smoothingSeconds: 0.08,
  /** 傾きを選んでからこの秒数のうちに値が来なければ「この端末では傾きを読めない」 */
  probeSeconds: 1.5,
} as const;

/**
 * ドラッグ操作（9-4。src/ui/drag-surface.ts）: 押さえた点と画面の中央のずれ ÷ (画面の高さ × radiusRatio) を
 * 「方向へ倒す」のスティックの値にする（直線。デッドゾーン・カーブは使わない: 押さえた所へそのまま向ける。画面の傾きで戻す: rereadPx）。
 * 画面の上端の近く（中央から 0.9 × radiusRatio × 高さより上）を押さえ続けると、上へ端まで倒した扱いで宙返り
 */
export const DRAG_CONFIG = {
  radiusRatio: 0.45,
  /**
   * 画面の傾き（カメラは機体と一緒に傾く）で、押さえた点を地平線の基準に戻す。読み直すのは押さえた瞬間と、指をこの px より
   * 動かしたときだけ（止めている間は同じ向き = スティックを倒し続けるのと同じ。宙返りの間は読み直さない）
   */
  rereadPx: 12,
  /** 押さえた点の印の直径（px） */
  markerSize: 44,
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
    get tilt() {
      return t('controls.steer.modes.tilt');
    },
    get drag() {
      return t('controls.steer.modes.drag');
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

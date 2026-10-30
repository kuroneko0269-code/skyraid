// 操作補助（4-12）の数値。実機のスマホで「敵を捉えられない」と評価されたので足した。飛行モデルの数値は変えず、入力・判定・カメラ・HUD で補う。
// 角度は度、距離は m、時間は秒。ロジックは src/combat/aim-assist.ts・src/render/camera-rig.ts・src/ui/hud-feed.ts

/** ポーズメニューの設定「エイムアシスト」「ターゲットカメラ」「HUD 補助」の保存先（セーブの settings.assist に振り分ける） */
export const ASSIST_SETTINGS_KEYS = {
  aim: 'skyraid.assist.aim',
  camera: 'skyraid.assist.camera',
  hud: 'skyraid.assist.hud',
} as const;

export type AssistKind = keyof typeof ASSIST_SETTINGS_KEYS;

/** 設定の表示名と初期値（どれも ON。エイムアシストはタッチ・パッドで操作しているときだけ効く） */
export const ASSIST_SETTINGS: Readonly<
  Record<AssistKind, { readonly label: string; readonly defaultOn: boolean }>
> = {
  aim: { label: 'エイムアシスト', defaultOn: true },
  camera: { label: 'ターゲットカメラ', defaultOn: true },
  hud: { label: 'HUD 補助', defaultOn: true },
};

/**
 * エイムアシスト（タッチ・パッドのときだけ）。選択中の対象（機銃の射程内なら予測照準点）が機首から coneDeg 以内なら、
 * 機首をそちらへ向ける向きにピッチ・ヨーの入力を足す。足す量は角度の差に比例し（fullCorrectionDeg で最大）、最大 maxCorrection。
 * 操縦の入力（ピッチ・ロール・ヨーの絶対値の最大）が 0 なら足さない（勝手に追わない）。fullInput 未満では入力に比例して弱める
 */
export const AIM_ASSIST_CONFIG = {
  coneDeg: 8,
  /** 円錐の縁の手前 edgeFadeDeg で補正を 0 へ弱める（8° をまたいで急に効き始めない） */
  edgeFadeDeg: 2,
  maxCorrection: 0.25,
  fullCorrectionDeg: 4,
  fullInput: 0.2,
  /** タッチ・パッドのときの機銃の当たり判定の半径の倍率（自機の弾だけ。敵の弾・ミサイル・ロケットは変えない） */
  gunHitRadiusScale: 1.3,
} as const;

/**
 * ターゲットカメラ（追従カメラのときだけ）。選択中の対象が画面の端に近づく（視線から「画面の半分の画角 − startMarginDeg」を超える）と、
 * 注視点を対象の側へ回し、「半分の画角 + fullMarginDeg」で最大 maxShiftDeg。自機は画面の端から aircraftMarginDeg 内側に残す。
 * 寄せる量は response（1/秒）でなめらかに追う
 */
export const TARGET_CAMERA_CONFIG = {
  maxShiftDeg: 15,
  startMarginDeg: 6,
  fullMarginDeg: 10,
  aircraftMarginDeg: 8,
  response: 3,
} as const;

/** HUD 補助（src/ui/hud-assist.ts） */
export const HUD_ASSIST_CONFIG = {
  /** 角度差の矢印: 画面中央の○（半径 ringRadius px。狭い画面は compactRingRadius）。角度差が minAngleDeg 未満なら出さない */
  ringRadius: 74,
  compactRingRadius: 54,
  minAngleDeg: 3,
  /** 距離の色: 接近の速さ（m/s。正が接近）がこれを超えると「接近」、−これを下回ると「離脱」。間は前の色のまま */
  closureThreshold: 5,
  /** レーダーの高度差の三角: 自機との高度差がこれを超える点に上 ▲ / 下 ▼ */
  altitudeThreshold: 150,
  /** BEHIND: 自機の尾部から rearConeDeg 以内・range 以内の敵機 */
  behind: { rearConeDeg: 60, range: 1500 },
} as const;

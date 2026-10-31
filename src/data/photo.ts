// フォトモード（7-A）の数値: 軌道カメラの制限・操作の感度・プリセット角度・画面の調整の範囲・解像度・透かし。
// ロジックは src/core/photo-orbit.ts / photo-grade.ts / photo-capture.ts（Three.js 非依存）

/** 軌道カメラ（機体中心）の制限と感度 */
export const PHOTO_ORBIT = {
  /** 機体からカメラまでの距離（m）。平行移動を含めても maxDistance を超えない */
  minDistance: 4,
  maxDistance: 300,
  /** 注視点の平行移動の上限（m。機体から） */
  maxPan: 120,
  /** 仰角の上限（度。真上・真下で向きが決まらなくなるのを避ける） */
  maxElevation: 85,
  /** 画角（度） */
  minFov: 20,
  maxFov: 110,
  /** ロール（度） */
  maxRoll: 45,
  /** カメラを地面・海面からこれ以上離す（m） */
  groundClearance: 2,
  /** ドラッグ 1px で回る角度（度） */
  rotatePerPixel: 0.3,
  /** ホイール 1 ノッチ（deltaY 100）・ピンチで距離を掛ける倍率の底（距離 × base^(deltaY/100)） */
  zoomBase: 1.12,
  /** 平行移動: 画面の高さ 1 つ分ドラッグで、距離 × panPerScreen だけ動く */
  panPerScreen: 1,
  /** 入ったときの角度（今の追従カメラに近い後方やや上） */
  initial: { azimuth: 180, elevation: 12, distance: 28, fov: 60 },
} as const;

export interface PhotoPreset {
  readonly id: string;
  readonly label: string;
  /** 方位（度）: 0 = 機首の正面から機体を見る、90 = 右の真横、180 = 真後ろ（機首の向きの水平の枠で測る） */
  readonly azimuth: number;
  /** 仰角（度）: 正 = 上から、負 = 下から見上げる */
  readonly elevation: number;
  readonly distance: number;
  readonly fov: number;
  /** 注視点のずらし（m。機首の向きの水平の枠: x 右・y 上・z 前） */
  readonly pan: { readonly x: number; readonly y: number; readonly z: number };
}

/** プリセット角度 6 種（正面 / 真横 / 後方上 / 翼端 / 地上から見上げ / 俯瞰） */
export const PHOTO_PRESETS: readonly PhotoPreset[] = [
  { id: 'front', label: '正面', azimuth: 0, elevation: 6, distance: 24, fov: 45, pan: zero() },
  { id: 'side', label: '真横', azimuth: 90, elevation: 0, distance: 32, fov: 40, pan: zero() },
  {
    id: 'rear-high',
    label: '後方上',
    azimuth: 180,
    elevation: 25,
    distance: 36,
    fov: 55,
    pan: zero(),
  },
  // 右の翼端の外から、翼に沿って胴体と機首を見る（広角で近く）
  {
    id: 'wingtip',
    label: '翼端',
    azimuth: 120,
    elevation: 4,
    distance: 10,
    fov: 75,
    pan: { x: 4, y: 0, z: 0 },
  },
  // 下から見上げる（地面が近いときはカメラを地面の上に止める）
  {
    id: 'low',
    label: '見上げ',
    azimuth: 30,
    elevation: -35,
    distance: 60,
    fov: 50,
    pan: zero(),
  },
  { id: 'top', label: '俯瞰', azimuth: 180, elevation: 80, distance: 120, fov: 45, pan: zero() },
];

function zero(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 };
}

/** 被写界深度（画質「高」のみ）: ピントの距離（m）とボケの強さ（BokehPass の aperture に掛ける） */
export const PHOTO_FOCUS = {
  minDistance: 2,
  maxDistance: 2000,
  /** ボケ 0〜1 → aperture（0 でボケなし） */
  maxAperture: 0.0008,
  /** ボケの最大（画面の高さに対する割合） */
  maxBlur: 0.012,
  defaultBlur: 0.4,
} as const;

/** 画面の調整（ポストエフェクトの一時上書き）の範囲。既定値はいつもの画面と同じ */
export const PHOTO_GRADE_RANGE = {
  /** 露出（EV） */
  exposure: { min: -2, max: 2, step: 0.1, default: 0 },
  /** コントラスト（1 = そのまま） */
  contrast: { min: 0.5, max: 1.5, step: 0.05, default: 1 },
  /** 彩度（1 = そのまま、0 = 白黒） */
  saturation: { min: 0, max: 2, step: 0.05, default: 1 },
  /** ビネット（四隅の暗さ。既定は 4-1 の 0.22） */
  vignette: { min: 0, max: 1, step: 0.02, default: 0.22 },
  /** フィルムグレイン（0 = なし） */
  grain: { min: 0, max: 1, step: 0.05, default: 0 },
  /** 色温度（−1 暖 〜 +1 寒。0 = そのまま） */
  temperature: { min: -1, max: 1, step: 0.05, default: 0 },
} as const;

export const PHOTO_FILTERS = ['none', 'film', 'mono', 'sepia', 'punch'] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];

export const PHOTO_FILTER_LABELS: Readonly<Record<PhotoFilter, string>> = {
  none: 'なし',
  film: 'フィルム',
  mono: 'モノクロ',
  sepia: 'セピア',
  punch: '高コントラスト',
};

/** シェーダーに渡すフィルターの番号（PHOTO_FILTERS の順） */
export function filterIndex(f: PhotoFilter): number {
  return PHOTO_FILTERS.indexOf(f);
}

/**
 * 色温度 ±1 で掛ける RGB の倍率（暖 = 赤を上げ青を下げる。約 ±1500K 相当）。グレインの強さ 1 の振幅（線形の明るさの割合）
 */
export const PHOTO_GRADE_LOOK = {
  warm: [1.12, 1.0, 0.84] as const,
  cool: [0.88, 0.98, 1.14] as const,
  grainAmplitude: 0.12,
} as const;

export const PHOTO_RESOLUTIONS = ['screen', 'double', 'uhd'] as const;
export type PhotoResolution = (typeof PHOTO_RESOLUTIONS)[number];

export const PHOTO_RESOLUTION_LABELS: Readonly<Record<PhotoResolution, string>> = {
  screen: '画面サイズ',
  double: '2 倍',
  uhd: '4K',
};

/** 保存の解像度: 4K は長辺 3840px（縦横比は画面のまま）。スマホは 2 倍まで */
export const PHOTO_CAPTURE = {
  uhdLongSide: 3840,
  /** 描画バッファの上限（GPU の最大サイズがこれより小さければそちら） */
  maxSide: 8192,
} as const;

/** 透かし「SkyRaid」（右下。画像の短辺に対する割合） */
export const PHOTO_WATERMARK = {
  text: 'SkyRaid',
  /** 文字の高さ（短辺に対する割合） */
  size: 0.028,
  /** 右下からの余白（短辺に対する割合） */
  margin: 0.02,
  alpha: 0.7,
} as const;

/** UI */
export const PHOTO_UI = {
  /** 「UI を隠す」から戻すダブルタップの間隔（ms） */
  doubleTapMs: 350,
  /** シャッターの白いフラッシュ（秒） */
  flashSeconds: 0.25,
  /** ファイル名の前半 */
  filePrefix: 'skyraid',
} as const;

/** シャッター音（合成。帯域を絞ったノイズの短い 2 発） */
export const PHOTO_SHUTTER = {
  gain: 0.5,
  freq: 3200,
  q: 0.9,
  /** 1 発の長さと、2 発目までの間（秒） */
  click: 0.035,
  gap: 0.075,
  secondGain: 0.7,
} as const;

/** 画面の調整の名前（photo-grade の GradeKey） */
export const PHOTO_GRADE_LABELS = {
  exposure: '露出',
  contrast: 'コントラスト',
  saturation: '彩度',
  vignette: 'ビネット',
  grain: 'グレイン',
  temperature: '色温度',
} as const satisfies Readonly<Record<keyof typeof PHOTO_GRADE_RANGE, string>>;

export type PhotoShowKind = 'hud' | 'touch' | 'aircraft' | 'enemies' | 'effects';

/** 表示の切替（HUD・タッチ操作は入ったとき隠す、他は出す） */
export const PHOTO_SHOW_ITEMS: readonly { kind: PhotoShowKind; label: string }[] = [
  { kind: 'hud', label: 'HUD' },
  { kind: 'touch', label: 'タッチ操作' },
  { kind: 'aircraft', label: '機体' },
  { kind: 'enemies', label: '敵・怪獣' },
  { kind: 'effects', label: 'エフェクト' },
];

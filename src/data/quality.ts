// 品質設定（低/中/高）のパラメータ。適用は src/render/pipeline.ts、選択ロジックは src/core/settings.ts

export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityPreset {
  /** シャドウマップを使うか（本体の実装はフェーズ4） */
  readonly shadows: boolean;
  /** devicePixelRatio の上限 */
  readonly maxPixelRatio: number;
  /** ポストエフェクト（ブルーム等）を使うか（本体の実装はフェーズ4） */
  readonly postEffects: boolean;
  /** 描画距離（m）。カメラの far と霧の範囲に使う */
  readonly drawDistance: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: { shadows: false, maxPixelRatio: 1, postEffects: false, drawDistance: 3000 },
  medium: { shadows: true, maxPixelRatio: 1.5, postEffects: false, drawDistance: 5000 },
  high: { shadows: true, maxPixelRatio: 2, postEffects: true, drawDistance: 8000 },
};

/** UI 表示名 */
export const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = {
  low: '低',
  medium: '中',
  high: '高',
};

export const QUALITY_CONFIG = {
  /** localStorage のキー。値は QualityLevel の文字列 */
  storageKey: 'skyraid.quality',
  /** 自動判定で「低」以外にする場合の既定 */
  defaultLevel: 'medium',
  /** タッチ端末の既定 */
  touchLevel: 'low',
  /**
   * GPU 名（WebGL の RENDERER）がこれに当たれば「低」にする。
   * ソフトウェアレンダラーとモバイル GPU
   */
  lowGpuPatterns: [
    /swiftshader/i,
    /llvmpipe/i,
    /softpipe/i,
    /software/i,
    /microsoft basic render/i,
    /mali/i,
    /adreno/i,
    /powervr/i,
  ],
  /** 霧の開始/終了を描画距離に対する比で決める */
  fogNearRatio: 0.1,
  fogFarRatio: 0.7,
} as const satisfies {
  storageKey: string;
  defaultLevel: QualityLevel;
  touchLevel: QualityLevel;
  lowGpuPatterns: readonly RegExp[];
  fogNearRatio: number;
  fogFarRatio: number;
};

// デバッグ表示（fps 等）の集計パラメータ
export const DEBUG_OVERLAY_CONFIG = {
  /** fps / frame ms を平均して表示を更新する間隔（秒） */
  sampleSeconds: 0.5,
} as const;

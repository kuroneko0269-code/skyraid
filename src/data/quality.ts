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
  /** 地形の LOD で使う最も細かい段（0 が最も細かい。src/data/terrain.ts の lod.segments） */
  readonly terrainMinLod: number;
  /** 海面を簡略シェーダー（波 1 本・さざ波なし・頂点でフレネル）で描くか */
  readonly oceanSimple: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    shadows: false,
    maxPixelRatio: 1,
    postEffects: false,
    drawDistance: 3000,
    terrainMinLod: 1,
    oceanSimple: true,
  },
  medium: {
    shadows: true,
    maxPixelRatio: 1.5,
    postEffects: false,
    drawDistance: 5000,
    terrainMinLod: 0,
    oceanSimple: false,
  },
  high: {
    shadows: true,
    maxPixelRatio: 2,
    postEffects: true,
    drawDistance: 8000,
    terrainMinLod: 0,
    oceanSimple: false,
  },
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
  /**
   * 自動判定で低性能 GPU に当たらないときの既定（タッチ端末も含む。iPhone 17 で「高」でも
   * 60fps だったため、タッチ端末を「低」にするのをやめた）
   */
  defaultLevel: 'medium',
  /** 低性能 GPU のときの既定 */
  lowLevel: 'low',
  /**
   * GPU 名（WebGL の RENDERER）がこれに当たれば「低」にする。明らかに遅いソフトウェアレンダラーだけ。
   * モバイル GPU（Mali / Adreno / PowerVR）は性能の幅が広いので名前では決めず、自動ダウングレードに任せる
   */
  lowGpuPatterns: [
    /swiftshader/i,
    /llvmpipe/i,
    /softpipe/i,
    /software/i,
    /microsoft basic render/i,
  ],
  /**
   * 自動ダウングレード: 飛行開始から sampleSeconds 秒間の平均 fps が minFps 未満なら一段下げて
   * storageKey に保存し、HUD に noticeSeconds 秒間 notice を出す。手動設定（上の storageKey）があれば行わない
   */
  autoDowngrade: {
    storageKey: 'skyraid.qualityAuto',
    sampleSeconds: 5,
    minFps: 30,
    noticeSeconds: 2,
    notice: '画質を下げました',
  },
  /** 霧の開始/終了を描画距離に対する比で決める */
  fogNearRatio: 0.1,
  fogFarRatio: 0.7,
} as const satisfies {
  storageKey: string;
  defaultLevel: QualityLevel;
  lowLevel: QualityLevel;
  lowGpuPatterns: readonly RegExp[];
  autoDowngrade: {
    storageKey: string;
    sampleSeconds: number;
    minFps: number;
    noticeSeconds: number;
    notice: string;
  };
  fogNearRatio: number;
  fogFarRatio: number;
};

// デバッグ表示（fps 等）の集計パラメータ
export const DEBUG_OVERLAY_CONFIG = {
  /** fps / frame ms を平均して表示を更新する間隔（秒） */
  sampleSeconds: 0.5,
} as const;

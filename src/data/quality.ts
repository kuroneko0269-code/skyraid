// 品質設定（低/中/高）のパラメータ。適用は src/render/pipeline.ts、選択ロジックは src/core/settings.ts
import type { AircraftDetail } from './aircraft-model';

export const QUALITY_LEVELS = ['low', 'medium', 'high'] as const;

export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityPreset {
  /** 太陽光のシャドウマップ（機体のまわり 600m。src/data/sky.ts の SHADOW_CONFIG） */
  readonly shadows: boolean;
  /** シャドウマップの解像度（shadows が false なら使わない） */
  readonly shadowMapSize: number;
  /** devicePixelRatio の上限 */
  readonly maxPixelRatio: number;
  /**
   * ポストエフェクト（EffectComposer: HDR のレンダーターゲット + ビネット + ACES）を使うか。
   * false はレンダラー側の ACES トーンマッピングだけ
   */
  readonly postEffects: boolean;
  /** ブルーム（postEffects が true のときだけ効く）。無い画質は太陽のまぶしさをスカイシェーダーで描く */
  readonly bloom: boolean;
  /** 地形の近距離のディテール（三面マッピングの手続きノイズ）と PBR のマテリアル。false は Lambert */
  readonly terrainDetail: boolean;
  /** 描画距離（m）。カメラの far と霧の範囲に使う */
  readonly drawDistance: number;
  /**
   * 地形の LOD で使う最も細かい段（0 が最も細かい。src/data/terrain.ts の lod.segments）。
   * 「低」は 2（約 31m。4-7 で約 8m の段を足す前の 1 と同じ間隔）
   */
  readonly terrainMinLod: number;
  /** 海面を簡易版（カメラ追従の平面・うねり 1 本・水の色と空の色は頂点で計算）で描くか */
  readonly oceanSimple: boolean;
  /**
   * 海面のさざ波の法線ノイズの層数（フラグメント。src/data/ocean.ts の normalLayers の先頭から）。
   * 簡易版は 1、「中」2、「高」3
   */
  readonly oceanLayers: number;
  /** 画面空間の反射の代わりに、海の空の反射と太陽の照り返しを少し強める（OCEAN_CONFIG.highBoost） */
  readonly oceanBoost: boolean;
  /** 雲の方式。volume = 板 1 枚の疑似体積（レイマーチング）、billboard = InstancedMesh の板 */
  readonly cloudMode: CloudMode;
  /** 疑似体積の歩数（CLOUD_CONFIG.volume.maxSteps 以下。billboard では使わない） */
  readonly cloudSteps: number;
  /** 雲の影（地形と海を雲の密度で暗くする。シャドウマップは使わない） */
  readonly cloudShadows: boolean;
  /**
   * 木の本数（4-6。src/render/vegetation.ts。配置は決定的で、少ない画質は多い画質の先頭の部分集合）。
   * 4-7 で森の密度を 3 倍に: 「高」は 30000 → 90000、「中」は上限の 20000（12000 から）。「低」は据え置き
   */
  readonly treeCount: number;
  /** 木を 3〜5 本の束で置く（4-7。src/data/vegetation.ts の clump。遠景のビルボードは束ごとに 1 枚） */
  readonly treeClumps: boolean;
  /** 岩・崖の法線の細部（4-6。手続きノイズで法線を揺らし、光の当たり方で凹凸を見せる。terrainDetail が true のときだけ） */
  readonly terrainNormalDetail: boolean;
  /**
   * 機体モデルの細かさ（4-3。src/data/aircraft-model.ts）。「低」は LOD（1 機 3000 三角形以下）。
   * ハンガーの展示は画質によらず high
   */
  readonly aircraftDetail: AircraftDetail;
  /** 陽炎を画面を歪める屈折で描く（4-4。ポストエフェクトの仕上げのパス）。false は薄い半透明の揺らぎ */
  readonly heatHazeRefraction: boolean;
  /** 森の地面に、木の影の代わりに太陽と反対側へずらした暗いまだらを描く（4-6。シャドウマップは使わない） */
  readonly treeShade: boolean;
}

export const CLOUD_MODES = ['billboard', 'volume'] as const;

export type CloudMode = (typeof CLOUD_MODES)[number];

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    shadows: false,
    shadowMapSize: 0,
    maxPixelRatio: 1,
    postEffects: false,
    bloom: false,
    terrainDetail: false,
    drawDistance: 3000,
    terrainMinLod: 2,
    oceanSimple: true,
    oceanLayers: 1,
    oceanBoost: false,
    cloudMode: 'billboard',
    cloudSteps: 0,
    cloudShadows: false,
    treeCount: 3000,
    treeClumps: false,
    terrainNormalDetail: false,
    treeShade: false,
    aircraftDetail: 'low',
    heatHazeRefraction: false,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    maxPixelRatio: 1.5,
    postEffects: true,
    bloom: false,
    terrainDetail: true,
    drawDistance: 5000,
    terrainMinLod: 0,
    oceanSimple: false,
    oceanLayers: 2,
    oceanBoost: false,
    cloudMode: 'volume',
    cloudSteps: 8,
    cloudShadows: false,
    treeCount: 20000,
    treeClumps: true,
    terrainNormalDetail: true,
    treeShade: false,
    aircraftDetail: 'high',
    heatHazeRefraction: false,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    maxPixelRatio: 2,
    postEffects: true,
    bloom: true,
    terrainDetail: true,
    drawDistance: 8000,
    terrainMinLod: 0,
    oceanSimple: false,
    oceanLayers: 3,
    oceanBoost: true,
    cloudMode: 'volume',
    cloudSteps: 12,
    cloudShadows: true,
    treeCount: 90000,
    treeClumps: true,
    terrainNormalDetail: true,
    treeShade: true,
    aircraftDetail: 'high',
    heatHazeRefraction: true,
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
  /**
   * 空気遠近（散乱の霧）とは別に、描画距離の果てを空の色に溶かしきる範囲（描画距離に対する比）。
   * 地形・海の切れ目を隠す
   */
  fogNearRatio: 0.55,
  fogFarRatio: 0.9,
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

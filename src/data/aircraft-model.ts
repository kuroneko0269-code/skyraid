// 機体モデル（4-3）の生成・見た目・動くパーツの数値。形は src/data/aircraft-shapes.ts、生成は src/render/aircraft-model/。
// 長さは m、角度は度、時間は秒。docs/spec.md「10. ビジュアル」の「機体モデル」

/** 細かさ。high = 画質「中」「高」とハンガー、low = 画質「低」（LOD） */
export type AircraftDetail = 'high' | 'low';

export interface AircraftDetailSpec {
  /** 胴体の周方向の分割数・前後の断面の数 */
  readonly fuselageRadial: number;
  readonly fuselageStations: number;
  /** 翼型の片面の点の数 */
  readonly airfoilPoints: number;
  /** 翼の端の面取りの段数（0 で面取りなし） */
  readonly bevelSegments: number;
  /** ノズル・インテーク・ナセルの周方向の分割数 */
  readonly ductRadial: number;
  /** キャノピーの分割（周方向・縦方向） */
  readonly canopySegments: readonly [number, number];
  /** ミサイルの胴の分割数。フィンを付けるか */
  readonly missileRadial: number;
  readonly missileFins: boolean;
}

export const AIRCRAFT_MODEL_CONFIG = {
  detail: {
    high: {
      fuselageRadial: 28,
      fuselageStations: 46,
      airfoilPoints: 9,
      bevelSegments: 1,
      ductRadial: 20,
      canopySegments: [20, 8],
      missileRadial: 8,
      missileFins: true,
    },
    low: {
      fuselageRadial: 12,
      fuselageStations: 18,
      airfoilPoints: 4,
      bevelSegments: 0,
      ductRadial: 8,
      canopySegments: [8, 3],
      missileRadial: 4,
      missileFins: false,
    },
  } satisfies Record<AircraftDetail, AircraftDetailSpec>,
  /** 1 機の三角形の数の目安（テストで確かめる）。low は上限だけ */
  triangleBudget: { highMin: 6000, highMax: 12000, lowMax: 3000 },
  /** 翼の端の面取りの大きさ（m） */
  bevel: 0.025,
  /** 操舵面: エルロンは主翼の翼幅の 45〜88%、翼弦の後ろ 25%。ラダーは垂直尾翼の高さの 10〜85%、翼弦の後ろ 30% */
  surfaces: {
    aileronSpan: [0.45, 0.88],
    aileronChord: 0.75,
    rudderSpan: [0.1, 0.85],
    rudderChord: 0.7,
    /** 水平尾翼は全体が動く（全遊動式）。回転軸は付け根の翼弦の 35% */
    stabilizerHinge: 0.35,
    /** 入力 ±1 での最大の角度 */
    maxDeflectionDeg: 20,
    /** 見た目の角度が入力に追いつく速さ（1/秒）。約 0.08 秒の遅れ */
    response: 12,
  },
  /** ミサイル（パイロンの搭載物）の寸法。パイロンは翼端から内側へ間隔 spacing（最大）で左右対称に、奇数なら胴体の下に 1 発 */
  missile: {
    length: 2.9,
    radius: 0.09,
    spacing: 1.0,
    /** パイロンを置ける主翼の内側の限界（翼幅の半分に対する割合） */
    innerLimit: 0.3,
    color: 0xd8d8d4,
    seekerColor: 0x2a2a2a,
  },
  /** 敵機の翼端に見せるミサイルの数（敵の弾数は共有のプールなので見た目だけ） */
  enemyMissiles: 2,
  /** 頂点の色: インテーク・ノズルの内側、レドーム（機首の先端。機体の色に掛ける）、敵・輸送機のキャノピー */
  colors: {
    duct: 0x111214,
    nozzle: 0x2b2725,
    radomeShade: 0.78,
    canopyOpaque: 0x14181d,
  },
  /**
   * envIntensity（4-10 事前修正）: 空の環境マップ（render/sky-environment.ts）の効き。影側を空の色で持ち上げる。
   * 半球ライトの空の光と重なるので 1 より小さくする
   */
  paint: { metalness: 0.3, roughness: 0.62, normalScale: 0.4, envIntensity: 0.6 },
  /** キャノピー（自機・ハンガー）: 半透明の濃い色、反射はクリアコート */
  canopy: {
    color: 0x1d2a33,
    opacity: 0.62,
    roughness: 0.08,
    metalness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envIntensity: 1,
  },
  /** パネルラインと汚れの手続きテクスチャ（1 枚の濃さから色と法線マップを作る） */
  texture: {
    size: 512,
    /** パネルラインの濃さ（色に掛ける）と幅（画素） */
    lineShade: 0.86,
    lineWidth: 1.1,
    /** 排気周りの煤: 胴体の後ろのこの割合から、後端で色をこの値まで暗くする */
    sootStart: 0.84,
    sootShade: 0.35,
    /** 主翼の付け根の汚れ: 翼幅（中心線から）のこの割合まで、付け根で色をこの値まで暗くする */
    rootGrimeSpan: 0.3,
    rootGrimeShade: 0.72,
    /** 塗装のむら（±） */
    mottle: 0.05,
  },
} as const;

/** アフターバーナーの炎（自機）: ノズルから後ろへ伸びる青白いコーン。長さが脈動する。加算なしの発光 */
export const AFTERBURNER_FLAME_CONFIG = {
  /** 長さ（m）と半径（ノズルの外の半径に対する割合） */
  length: 3.6,
  radiusRatio: 0.78,
  /** 根元・先端の色と不透明度 */
  coreColor: 0xdfeaff,
  tipColor: 0x5a8cff,
  coreOpacity: 0.9,
  /** 発光の強さ（露出後の明るさ。1 で色そのまま） */
  intensity: 2.6,
  /** 脈動: 長さ ±pulseAmount を pulseHz で（2 つの周波数を重ねる） */
  pulseAmount: 0.14,
  pulseHz: [11, 17.3],
  /** 点火・消火で長さが変わる速さ（1/秒） */
  response: 14,
} as const;

/**
 * 飛行機雲（自機）: 高 G 旋回中に両翼端から白い玉を出す（ミサイルの煙と同じ SmokeTrail）。
 * G はピッチの角速度 × 速度 ÷ 9.8 + 1（アーケードの値なので実機より大きい。巡航 250 m/s で最大ピッチの約 56%）
 */
export const CONTRAIL_CONFIG = {
  minLoadFactor: 20,
  /** 玉の間隔（m）。フレームの間の翼端の動きを補間して並べる */
  spacing: 1.2,
  /** 460 m/s ÷ 1.2m × 2 本 × 寿命 1 秒 ≈ 770 */
  max: 900,
  life: 1,
  /** 太さ（m）。出た直後 → 寿命の終わりへ広がり、最後の fadeFraction で細くなって消える */
  startSize: 0.3,
  endSize: 1.1,
  fadeFraction: 0.7,
  /** 玉を進む向きへ伸ばす長さ（m）。間隔より長くして隣と重ね、1 本の筋に見せる */
  length: 2.2,
  color: 0xffffff,
  opacity: 0.24,
  /** 日陰側も白く見せる（露出後の明るさ） */
  emissive: 0.45,
} as const;

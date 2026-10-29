// HUD（1-4）の数値。DOM は src/ui/hud.ts、計算は src/ui/hud-math.ts
// 寸法は CSS px

export const HUD_CONFIG = {
  /** 地表（島の上は地形、海の上は海面）との距離がこれ未満で地面接近警告（m） */
  groundWarningAgl: 100,
  /** 失速表示を出す失速の度合い（FlightState.stall、0〜1）。0 より大きければ失速中 */
  stallThreshold: 0,
  /** 命中したとき中央に × を出す時間（秒）。2-1 */
  hitMarkerSeconds: 0.1,
  ladder: {
    /** 目盛りの間隔（度）。±90 まで */
    stepDeg: 10,
    /** 1 度あたりの px（通常 / 画面が狭いとき） */
    pxPerDeg: 8,
    compactPxPerDeg: 5,
    /** ラダーを表示する窓（楕円で切り抜く）の幅・高さ */
    width: 260,
    height: 280,
    compactWidth: 180,
    compactHeight: 170,
    /** 目盛りの線の長さ（水平線は horizonWidth） */
    rungWidth: 110,
    compactRungWidth: 76,
    horizonWidth: 220,
    compactHorizonWidth: 150,
  },
  /** これより狭い・低い画面はラダーを縮小する（スマホ横画面を想定） */
  compactMaxWidth: 760,
  compactMaxHeight: 480,
  radar: {
    /** 円の縁までの距離（m）。島（半径約 2.9km）が起動位置（沖合 4.5km）から収まる大きさ */
    rangeM: 8000,
    /** 直径（通常 / 画面が狭いとき） */
    size: 120,
    compactSize: 88,
    /** 島の中心（地形は原点中心。src/data/terrain.ts） */
    islandCenter: { x: 0, z: 0 },
  },
  /** 表示を書き換える最小の変化量（毎フレームの DOM 書き込みを避ける） */
  epsilon: {
    /** ピッチラダーの角度（度） */
    angleDeg: 0.1,
    /** 進行方向マーカーの位置（px） */
    px: 0.5,
    /** レーダーの点の位置（円の半径 = 1） */
    radar: 0.005,
    /** スロットル・アフターバーナーゲージ（0〜1） */
    gauge: 0.005,
  },
} as const;

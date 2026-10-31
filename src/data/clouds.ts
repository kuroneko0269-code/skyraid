// 雲のパラメータ（4-2）。密度の計算は src/render/cloud-noise.ts（Three.js 非依存）、
// 描画は src/render/clouds.ts。距離・高さは m。流れる向き・速さは src/data/wind.ts

export const CLOUD_CONFIG = {
  /** 雲の層の下端と上端（海面基準） */
  base: 1500,
  top: 2200,
  /** 被覆率（0〜1）。上げるほど雲が増え、つながる。0.45 は晴れ間の多い積雲 */
  coverage: 0.45,
  /** 密度 1 のときの消散係数（1/m）。積雲の内側は約 0.02〜0.1 */
  extinction: 0.03,
  /**
   * 3D ノイズ（起動時に CPU で作るタイル状の 3D テクスチャ、size³）。形は shapeScale m ごとに
   * 繰り返し、細部（縁の削り）は detailScale m。weatherScale は被覆率を場所ごとに揺らす
   * 大きな模様（±weatherAmount）。繰り返しを目立たせない
   */
  noise: {
    size: 32,
    seed: 1500,
    shapeScale: 4200,
    detailScale: 640,
    detailWeight: 0.35,
    weatherScale: 23000,
    weatherAmount: 0.3,
  },
  /**
   * 遠くの雲は空気遠近（地形・海と同じ霧の式）で空の色に溶け、描画距離の果て
   * （QUALITY_CONFIG.fogNearRatio〜fogFarRatio）で消える。
   * 画質「中」以上の疑似体積: カメラ追従の板（層の下面・上面）から層の中を一定の歩数で進む。
   * maxSteps はシェーダーのループの上限（定数）。実際の歩数は画質（QualityPreset.cloudSteps）。
   * maxMarch は 1 本の視線で進む最大距離（浅い角度で層をかすめる視線の歩幅が粗くならないように）。
   * lightStep は太陽の方へ 1 回だけ取る密度の距離（自分の影。下から見ると底が暗くなる）
   */
  volume: { maxSteps: 12, maxMarch: 1500, lightStep: 140 },
  /**
   * 光: 太陽（前方散乱 g = forwardG と後方 backG の Henyey-Greenstein の混合。太陽の方を見ると縁が光る）
   * + 空の光（上ほど明るく、底は ambientBottom 倍）。albedo は白い面に対する明るさの倍率
   * + 低い太陽の下からの光（夕焼けの雲の下面。7-5b）
   */
  light: {
    forwardG: 0.6,
    backG: -0.15,
    forwardWeight: 0.6,
    ambientBottom: 0.45,
    albedo: 1,
    /** 低い太陽の下からの光（7-5b）が消える高さ（層の中の割合）。強さは LOW_SUN_CONFIG.cloudUnder */
    underFade: 0.5,
  },
  /**
   * 画質「低」のビルボード雲（InstancedMesh の板 1 枚ずつ）。カメラのまわり radius m の中に置き、
   * 外へ出たら反対側へ回り込む。大きさ m（横の幅。縦は heightRatio 倍）
   */
  billboards: { count: 40, radius: 2600, sizeMin: 450, sizeMax: 1100, heightRatio: 0.45, seed: 22 },
  /**
   * 雲の中を飛ぶときの霧（画面全体に薄い白）。層の中にいるだけで layerAlpha、
   * カメラの位置の雲の密度に応じて最大 densityAlpha まで濃くなる。edge m で層の端をぼかす。
   * response は濃さの追従の速さ（1/秒）
   */
  insideFog: { layerAlpha: 0.22, densityAlpha: 0.6, edge: 60, response: 4 },
  /**
   * 雲の影（画質「高」のみ）: 地面・海の点から太陽の方へ層の高さ shadowHeight（層の中の割合）まで
   * 伸ばした点の密度で暗くする。シャドウマップは使わない。strength は真っ暗に対する割合
   */
  shadow: { shadowHeight: 0.3, strength: 0.55, densityToShadow: 2.5 },
} as const;

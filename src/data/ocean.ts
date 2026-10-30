// 海面のパラメータ（4-2）。波の計算は src/render/gerstner.ts（Three.js 非依存）、
// 描画は src/render/ocean.ts。距離・高さは m、向きは度（風向き src/data/wind.ts からの差）

export const OCEAN_CONFIG = {
  /**
   * ゲルストナー波。angle は風向きからの差、wavelength は波長、amplitude は振幅（上下の片振幅）、
   * steepness は鋭さ（Q·k·A。水平に寄る量 = steepness / 波数。合計 < 1 なら波の頂点が輪にならない）。
   * 速さは深海の分散関係 ω = √(g·k) で波長から決まる（長いうねりほど速い）。
   * 振幅の合計は 1.38m（最大振幅 1.5m 以下：船酔い防止）。先頭 2 本がうねり、残りが風波
   */
  waves: [
    { angle: -20, wavelength: 220, amplitude: 0.5, steepness: 0.1 },
    { angle: 35, wavelength: 140, amplitude: 0.35, steepness: 0.1 },
    { angle: 0, wavelength: 42, amplitude: 0.22, steepness: 0.22 },
    { angle: 25, wavelength: 27, amplitude: 0.15, steepness: 0.18 },
    { angle: -30, wavelength: 17, amplitude: 0.1, steepness: 0.16 },
    { angle: 50, wavelength: 11, amplitude: 0.06, steepness: 0.14 },
  ],
  /** 振幅の合計の上限（テストで確認する） */
  maxAmplitude: 1.5,
  /** 重力加速度（分散関係に使う） */
  gravity: 9.8,
  /**
   * 浅瀬で波を小さくする（水深 minDepth で 0、fullDepth で元の振幅）。波打ち際で海面が砂浜に
   * かぶらないように。見た目だけで、衝突判定は「海面 = 高度 0」のまま
   */
  shoal: { minDepth: 0.3, fullDepth: 8 },
  /**
   * 画質「中」以上の海面メッシュ: カメラ中心の同心リング。角度の分割 angularSegments、
   * 半径は innerRadius から描画距離 × outerRatio まで等比（隣の輪との間隔 ≒ 円周方向の間隔）。
   * 頂点の間隔が波長の 1/4 を超える波は、1/8 を超えたところから消していく（遠くのちらつき防止）
   */
  rings: { angularSegments: 160, innerRadius: 2, outerRatio: 1.1 },
  /**
   * さざ波の法線（フラグメントの手続きノイズ。テクスチャ画像なし）。cell は模様の大きさ、
   * speed は流れる速さ（m/s）、angle は流れる向き（風向きからの差）、slope は傾きの強さ、
   * fade は消える距離（遠くでモアレにならないように）。画質「中」は先頭 2 層、「高」は 3 層
   */
  normalLayers: [
    { cell: 9, speed: 1.2, angle: 0, slope: 0.32, fade: { start: 250, end: 1600 } },
    { cell: 2.6, speed: 0.6, angle: 70, slope: 0.22, fade: { start: 80, end: 450 } },
    { cell: 0.8, speed: 0.3, angle: -45, slope: 0.14, fade: { start: 30, end: 140 } },
  ],
  /**
   * 真下を見たときの水の色（反射率）。沖（水深 deepDepth 以上）は濃紺、浅瀬はターコイズ。
   * 色は水深で exp(−水深 / depthScale) で混ぜる
   */
  deepColor: 0x0a2c4a,
  shallowColor: 0x2fb8b0,
  depthScale: 6,
  /** フレネルで混ぜる空の反射の強さ（0〜1）。画質「高」は highBoost.reflectivity 倍 */
  reflectivity: 0.9,
  /**
   * 太陽の照り返し（GGX）。roughness は近く（さざ波が見える範囲）と遠く（さざ波が消えた範囲）の
   * GGX の α。遠くは細かい波を粗さとして扱い、照り返しを広げる。strength は明るさの倍率
   */
  sunGlint: { roughnessNear: 0.07, roughnessFar: 0.2, strength: 1 },
  /**
   * 水面下の散乱っぽい明るさ: 太陽の方を見たとき、波の山が透けて緑がかって明るくなる。
   * 色（反射率）と強さ
   */
  subsurface: { color: 0x2aa58f, strength: 0.6 },
  /**
   * 海岸の泡: 海岸線からの距離（水深 ÷ 水深の勾配で見積もる。遠浅でも急でも帯の幅が揃う）が
   * width m より近いところに白い帯。帯の端は period 秒の周期で ±swing の割合だけ寄せては返す。
   * ノイズ（一辺 cell m）でちぎる。水深 maxDepth より深いところには出さない。albedo は泡の反射率
   */
  foam: { width: 26, swing: 0.35, period: 7, cell: 3.5, maxDepth: 3, albedo: 0.8 },
  /**
   * 水深の計算用に焼く地形の高さの格子（一辺 TERRAIN_CONFIG.size、resolution × resolution）。
   * 起動時に CPU で計算して浮動小数点のテクスチャにする（画像アセットではない）
   */
  depthMap: { resolution: 384 },
  /** 画質「高」: 画面空間の反射の代わりに、空の反射と太陽の照り返しを少し強める */
  highBoost: { reflectivity: 1.08, sunGlint: 1.3 },
  /**
   * 画質「低」（QualityPreset.oceanSimple）の簡易版: カメラ追従の平面（segments 分割、一辺は
   * 描画距離 × planeSizeRatio）、頂点の波は先頭のうねり 1 本を正弦波で、水の色と空の色は頂点で計算。
   * フラグメントでは法線ノイズ 1 層（normalLayers の先頭）でフレネルと照り返しだけ揺らす
   */
  simple: { segments: 64, planeSizeRatio: 2.5, sunShininess: 500, sunSpecular: 1 },
} as const;

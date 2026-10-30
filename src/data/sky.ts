// 空・大気散乱・太陽・露出のパラメータ（4-1）。計算は src/render/atmosphere-model.ts（Three.js 非依存）、
// シェーダーは src/render/atmosphere.ts。距離・高さは m、散乱係数は 1/m（海面での値）

export const SKY_CONFIG = {
  sun: {
    /**
     * 太陽の方向。方位は -Z（初期の進行方向）から右回り、仰角は地平線から（度）。
     * 7-5 の昼夜変化ではここを動かす（Atmosphere.setSun）。今は午後の光
     */
    azimuth: 40,
    elevation: 32,
    /** 大気の外での太陽の色温度（K）。大気を通った後の色は透過率を掛けて計算する */
    temperature: 5900,
    /**
     * ホワイトバランス（K）。この色温度の光を白として写す（写真の「太陽光」設定に近い）。
     * 大気を通って少し黄色くなった直射日光が白に近い暖色に、地平線の霞が白に写る
     */
    whiteBalance: 5300,
    /**
     * 大気の外での太陽の放射照度（シーンの単位。平行光源の intensity と同じ）。
     * 白い面（反射率 1）を真上から照らすと明るさ irradiance / π。露出で画面の明るさに合わせるので絶対値は任意
     */
    irradiance: 3,
    /** 太陽の円盤の視半径（度。実物 0.27° より大きくしてゲームで見えるように） */
    discRadius: 0.6,
    /**
     * 円盤の明るさ（太陽の放射照度に対する倍率）。トーンマッピング後に必ず白く飛ぶ明るさ。
     * 実物ほど明るくすると、ブルームの広いぼかしで画面全体が白っぽくなるので抑える
     */
    discRadiance: 40,
  },
  /** 大気（Rayleigh + Mie の単一散乱 + 多重散乱の近似）。Preetham / Hoffman-Preetham 系の近似 */
  atmosphere: {
    /** Rayleigh 散乱係数（R, G, B の代表波長 680 / 550 / 440nm。Bruneton / Hillaire の値） */
    rayleigh: [5.802e-6, 13.558e-6, 33.1e-6],
    /** Rayleigh のスケールハイト（密度が 1/e になる高さ） */
    rayleighHeight: 8000,
    /**
     * Mie（エアロゾル・もや）の散乱係数。晴れた日の値（約 4e-6）より濃くし、うすい霞にする
     * （地平線が白く霞む）。濃くしすぎると天頂の青が白っぽくなる
     */
    mie: 1.6e-5,
    /** Mie の散乱 / 消散の比（残りは吸収） */
    mieAlbedo: 0.9,
    /** Mie のスケールハイト（もやは低い層にたまる） */
    mieHeight: 1200,
    /** Mie の前方散乱の強さ（Henyey-Greenstein の g）。太陽のまわりが白く光る */
    mieG: 0.76,
    /**
     * 多重散乱の近似: 等方的な位相関数（1/4π）× この倍率の散乱を足す。空全体から来る光なので
     * 太陽の透過率を掛けない（地平線の霞が黄ばまず白〜淡い青になる）。単一散乱だけだと太陽と反対側の空が暗すぎる
     */
    multiScatter: 0.5,
  },
  /**
   * 空気遠近（地形・海・機体にかける散乱ベースの霧）。透過率は高さと距離で決まり、色は同じ向きの空の色。
   * 実際の大気のままだと描画距離（3〜8km）では薄すぎるので、距離をこの倍率で伸ばして計算する
   * （UE の Aerial Perspective View Distance Scale と同じ考え方。遠くの色は空と一致したまま）
   */
  aerial: {
    distanceScale: 3,
    /**
     * 上の倍率をカメラの高さで減らすスケールハイト（4-2b）。倍率 × exp(−カメラの高さ / heightFalloff):
     * 1000m で地上の 60%、2000m で 36%。地表付近の見え方（距離 3 倍）はそのまま、上空では霞が薄くなる
     */
    heightFalloff: 1960,
    /**
     * 低空の空気遠近を弱める（4-7）。カメラの高さ lowFrom m 以下は倍率を lowFactor 倍、lowFrom〜lowTo m で
     * 1 倍へなめらかに戻す（上の heightFalloff の減衰はそのまま掛ける。lowTo より上は 4-2b と同じ）。
     * 実機で海岸の低空から海と空の境目が見えなかった
     */
    lowFactor: 0.8,
    lowFrom: 500,
    lowTo: 700,
  },
  /**
   * 太陽のまわりのまぶしさ（スカイシェーダーで描く光芒）。ブルームのない画質「中」「低」で使う。
   * 太陽の放射照度 × strength × max(cos, 0)^exponent
   */
  glow: {
    strength: 0.6,
    exponent: 900,
    /** 広いにじみ（ブルームの裾の代わり） */
    wideStrength: 0.05,
    wideExponent: 40,
  },
  /** 空のドームの半径。深度テストなしで最初に描くので、far より小さければよい */
  radius: 1000,
  /** 空のドームの分割数（経度・緯度）。散乱は画素ごとに計算するので細かくなくてよい */
  domeSegments: { width: 32, height: 16 },
  /**
   * 機体の環境マップ（4-10 事前修正）: 起動時に 1 回、この高さ（m）から見た空を一辺 size のキューブに描いて
   * PMREM にする。太陽の円盤とまぶしさは入れない（太陽の光は平行光源が受け持つ）
   */
  environment: { size: 64, height: 500 },
} as const;

/**
 * 露出（トーンマッピング前の倍率）の決め方。シーンの代表的な明るさ（空と地面の対数平均）が
 * key（中間グレー）になるようにし、地面が minGround より暗くならないよう下限をかける
 */
export const EXPOSURE_CONFIG = {
  /**
   * 対数平均がこの明るさになるよう合わせる。写真の 18% グレーより少し暗めにして、
   * 頂点カラーの明るい草地が白っぽく浮かず、空の青が濃く出るようにする
   */
  key: 0.15,
  /** 対数平均での地面の重み（残りが空）。画面の下半分は地面・海 */
  groundWeight: 0.6,
  /** 露出の計算に使う地面の反射率（草地・森・砂の平均くらい） */
  groundAlbedo: 0.15,
  /** 露出後の地面の明るさの下限（これより暗いと ACES でつぶれる） */
  minGround: 0.14,
  /** 半球ライトの地面側（照り返し）に使う反射率（陸と海の平均） */
  bounceAlbedo: 0.1,
  /** 露出の上限（4-2b。空や地面の明るさの計算がどう転んでも、白く飛ぶほど上げない） */
  maxExposure: 3,
} as const;

/** ブルーム（画質「高」のみ。three/examples/jsm の UnrealBloomPass） */
export const BLOOM_CONFIG = {
  strength: 0.35,
  radius: 0.4,
  /**
   * 光らせる明るさのしきい値（露出後の輝度）。空や白い雲は光らず、太陽・マズルフラッシュ・爆発
   * （EMISSIVE_CONFIG で明るくしたもの）だけが超える
   */
  threshold: 2.2,
} as const;

/** ビネット（画面の四隅を少し暗くする）。中心からの距離² に比例 */
export const VIGNETTE_CONFIG = {
  /** 四隅（中心から距離 0.707）での暗さ（0〜1） */
  strength: 0.22,
} as const;

/** ポストエフェクトの描画先（HalfFloat のレンダーターゲット）のマルチサンプル数 */
export const POST_CONFIG = {
  samples: 4,
} as const;

/** 影（太陽光のシャドウマップ）。画質「中」以上。解像度は src/data/quality.ts の shadowMapSize */
export const SHADOW_CONFIG = {
  /** 影を計算する範囲（機体を中心にした一辺。m） */
  range: 600,
  /** 光源をどれだけ離すか（影の奥行きの範囲。機体の上下に range 程度あれば足りる） */
  distance: 800,
  bias: -0.0004,
  normalBias: 0.6,
} as const;

/**
 * 発光する演出の明るさ（色 × この倍率）。露出を掛けた後の明るさで指定する（1 で色そのまま）。
 * マズルフラッシュ・フレア・爆発の閃光はブルームのしきい値を超えて光り、曳光弾・火花は色が分かるよう
 * しきい値の下に収める（自機・敵の弾の色の区別を残す）
 */
export const EMISSIVE_CONFIG = {
  tracer: 1.1,
  spark: 1.3,
  muzzleFlash: 5,
  flare: 6,
  explosion: 5,
} as const;

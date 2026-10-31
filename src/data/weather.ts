// 天候と時間帯（7-5）。時間帯（太陽の高さ）× 天候 × 風の組み合わせをプリセットにする。
// 補間と時間の進行は src/core/weather-state.ts（Three.js 非依存）、描画への適用は src/render/weather/
import { SKY_CONFIG } from './sky';

export const TIMES_OF_DAY = ['dawn', 'day', 'evening', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const SKY_KINDS = ['clear', 'overcast', 'fog', 'rain'] as const;
export type SkyKind = (typeof SKY_KINDS)[number];

export const WIND_LEVELS = ['weak', 'strong'] as const;
export type WindLevel = (typeof WIND_LEVELS)[number];

/**
 * 太陽の通り道（時間の進行用）。仰角 = maxElevation × sin(2π(時 − 6) / 24)（6 時と 18 時に地平線）、
 * 方位 = 昼の方位（4-1 の 40°）+ (時 − 昼の時刻) × 15°/時。プリセットの時間帯は仰角から時刻を逆算する
 * （昼 32° の午後 = 15.63 時で方位 40°。4-1 の「昼・快晴」と同じ太陽）
 */
export const SUN_PATH = {
  maxElevation: 55,
  dayAzimuth: SKY_CONFIG.sun.azimuth,
  /** 1 時間に回る方位（度） */
  degreesPerHour: 15,
} as const;

/** 時間帯: 太陽の仰角（度）と、午前・午後のどちら側か（時刻の逆算に使う） */
export const TIME_OF_DAY_CONFIG: Readonly<
  Record<TimeOfDay, { elevation: number; side: 'morning' | 'afternoon'; label: string }>
> = {
  /** 橙〜桃（低い太陽の透過率が赤く、空の多重散乱が青いので、地平線の霞が桃色に寄る）。7-5b で 8 → 6° */
  dawn: { elevation: 6, side: 'morning', label: '早朝' },
  day: { elevation: SKY_CONFIG.sun.elevation, side: 'afternoon', label: '昼' },
  /** 赤橙。7-5b で 12 → 5°（地平線の赤橙・天頂の紫青・長い影） */
  evening: { elevation: 5, side: 'afternoon', label: '夕方' },
  /** 月光と星（太陽は地平線の下） */
  night: { elevation: -10, side: 'afternoon', label: '夜' },
};

// 低い太陽の色（旧 SUN_TINT）は 7-5b で大気散乱の計算（src/data/sky.ts の LOW_SUN_CONFIG）に置き換えた

/**
 * 天候ごとの値（すべて補間する）。
 * - overcast: 空を曇天の灰色（CIE の曇天の明るさの分布）へ混ぜる割合。直射光は overcast × directBlock だけ遮る
 * - coverage: 雲の被覆率（4-2 の 0.45 が快晴）。cloudDark: 雨雲の暗さ（0〜1）
 * - visibility: 霧・雨の視程（m。海面での値。気象光学距離 MOR: 消散係数 = 3.0 / 視程（コントラスト 5%））。0 は霧なし
 * - haze: 空気遠近（4-1 の距離の倍率）に掛ける倍率
 * - rain: 雨の強さ（0〜1。粒・海の波紋・音）
 * - lowVisibility: 視認性が悪い（1 で HUD の敵のマーカーが索敵距離の markerRangeFactor まで出ない）
 * - exposureBias: 露出の補正（EV。暗い雲を暗く写す）
 */
export interface SkyKindParams {
  readonly label: string;
  readonly overcast: number;
  readonly coverage: number;
  readonly cloudDark: number;
  readonly visibility: number;
  readonly haze: number;
  readonly rain: number;
  readonly lowVisibility: number;
  readonly exposureBias: number;
}

export const SKY_KIND_CONFIG: Readonly<Record<SkyKind, SkyKindParams>> = {
  clear: {
    label: '快晴',
    overcast: 0,
    coverage: 0.45,
    cloudDark: 0,
    visibility: 0,
    haze: 1,
    rain: 0,
    lowVisibility: 0,
    exposureBias: 0,
  },
  overcast: {
    label: '曇り',
    overcast: 0.8,
    coverage: 0.85,
    cloudDark: 0.15,
    visibility: 0,
    haze: 1.3,
    rain: 0,
    lowVisibility: 0,
    exposureBias: -0.25,
  },
  fog: {
    label: '霧',
    overcast: 0.75,
    coverage: 0.6,
    cloudDark: 0,
    visibility: 1500,
    haze: 2.5,
    rain: 0,
    lowVisibility: 1,
    exposureBias: 0,
  },
  rain: {
    label: '雨',
    overcast: 1,
    coverage: 0.95,
    cloudDark: 0.6,
    visibility: 4000,
    haze: 2,
    rain: 1,
    lowVisibility: 1,
    exposureBias: -0.45,
  },
};

/** 風: 0（弱）〜 1（強）を補間する。飛行モデルには影響させない（見た目と音だけ） */
export const WIND_LEVEL_CONFIG: Readonly<Record<WindLevel, { value: number; label: string }>> = {
  weak: { value: 0, label: '弱風' },
  strong: { value: 1, label: '強風' },
};

/**
 * 強風（風 1）での倍率。弱風（0）は 4-2 の値のまま。
 * 波: 風波（OCEAN_CONFIG.waves の 3 本目から）の振幅 × waveAmplitude、鋭さ × waveSteepness
 * （うねり 0.85m + 風波 0.53m × 1.2 = 1.49m で 4-2 の上限 1.5m 以内、鋭さの合計 0.97 < 1）。
 * さざ波の傾き × rippleSlope、雲の流れ × cloudSpeed、木の梢の振れ × treeSway・速さ × treeSpeed
 */
export const STRONG_WIND = {
  waveAmplitude: 1.2,
  waveSteepness: 1.1,
  rippleSlope: 1.35,
  cloudSpeed: 2.5,
  treeSway: 2.2,
  treeSpeed: 1.6,
} as const;

export interface WeatherPreset {
  readonly id: string;
  readonly time: TimeOfDay;
  readonly sky: SkyKind;
  readonly wind: WindLevel;
}

/** プリセット 8 種（組み合わせは自由。先頭がフリーフライトの初期値） */
export const WEATHER_PRESETS: readonly WeatherPreset[] = [
  { id: 'day-clear', time: 'day', sky: 'clear', wind: 'weak' },
  { id: 'dawn-clear', time: 'dawn', sky: 'clear', wind: 'weak' },
  { id: 'evening-clear', time: 'evening', sky: 'clear', wind: 'weak' },
  { id: 'night-clear', time: 'night', sky: 'clear', wind: 'weak' },
  { id: 'day-overcast', time: 'day', sky: 'overcast', wind: 'strong' },
  { id: 'dawn-fog', time: 'dawn', sky: 'fog', wind: 'weak' },
  { id: 'day-rain', time: 'day', sky: 'rain', wind: 'strong' },
  { id: 'night-rain', time: 'night', sky: 'rain', wind: 'strong' },
];

export const DEFAULT_WEATHER_ID = 'day-clear';

/** id のプリセット（知らない id は初期値） */
export function findWeather(id: string): WeatherPreset {
  return WEATHER_PRESETS.find((p) => p.id === id) ?? (WEATHER_PRESETS[0] as WeatherPreset);
}

export function isWeatherId(id: unknown): id is string {
  return typeof id === 'string' && WEATHER_PRESETS.some((p) => p.id === id);
}

/** 表示名（例「夕方・快晴・弱風」） */
export function weatherLabel(id: string): string {
  const p = findWeather(id);
  return `${TIME_OF_DAY_CONFIG[p.time].label}・${SKY_KIND_CONFIG[p.sky].label}・${WIND_LEVEL_CONFIG[p.wind].label}`;
}

/**
 * キャンペーンのミッションごとの天候（固定）。M1 昼・M2 早朝・M3 曇り・M4 夕方・M5 夜・雨。
 * ソロのレイドは夕方・快晴。ここにないミッション（チュートリアル）は昼・快晴
 */
export const MISSION_WEATHER: Readonly<Record<string, string>> = {
  training: 'day-clear',
  'first-sortie': 'dawn-clear',
  escort: 'day-overcast',
  strike: 'evening-clear',
  encounter: 'night-rain',
  raid: 'evening-clear',
};

export function missionWeather(missionId: string): string {
  return MISSION_WEATHER[missionId] ?? DEFAULT_WEATHER_ID;
}

/** 協力レイドのロビーの初期値（ホストが選べる）。PvP の初期値は DEFAULT_WEATHER_ID */
export const RAID_COOP_DEFAULT_WEATHER = 'evening-clear';

/**
 * 飛行に使う天候: PvP・協力（net）はロビーのホスト設定、ミッションは定義の固定、フリーフライトはモード選択で選んだもの
 */
export function weatherForFlight(
  net: boolean,
  missionId: string | null,
  netWeather: string,
  freeWeather: string,
): string {
  if (net) return findWeather(netWeather).id;
  if (missionId !== null) return missionWeather(missionId);
  return findWeather(freeWeather).id;
}

/** 遷移・時間の進行 */
export const WEATHER_TIME = {
  /** プリセットが変わるときの補間（秒） */
  transitionSeconds: 3,
  /** 「時間が流れる」（フリーフライトだけ）: 1 ゲーム日 = この実時間（秒） */
  dayLengthSeconds: 600,
} as const;

/**
 * 夜（太陽が地平線の下）。太陽の明るさは sunFade（仰角 from → to 度で 0 → 1）で消し、月は moonFade で出す。
 * 間（−8〜0°）は両方を足す（空はシェーダーで両方を計算するので、時間が流れても途切れない）。
 * 直射光（平行光源・影）は地上で明るい方の向き
 */
export const NIGHT_CONFIG = {
  sunFade: { from: -9, to: 1 },
  /** 夜らしさ（露出・星・HUD・マーカー）: 太陽の仰角 from → to 度で 0 → 1 */
  nightFade: { from: 2, to: -8 },
  /** 月の向き（固定。起動位置から左前に見える高さ） */
  moon: { azimuth: -28, elevation: 24 },
  /**
   * 月の明るさ（太陽の放射照度 3 に対する値。露出を固定するので見た目の明るさの比で決める）と色（青白い。
   * 輝度 1 に正規化して使う。プルキンエ現象で夜は青く見える）
   */
  moonIrradiance: 0.42,
  moonTint: [0.55, 0.78, 1.2] as const,
  /** 月の円盤の視半径（度）と明るさ（月の放射照度に対する倍率）、周囲の光（強さ・鋭さ） */
  moonDisc: { radius: 0.9, radiance: 260, haloStrength: 0.5, haloExponent: 400 },
  /** 夜の固定露出（4-1 の自動露出は使わない。上限 3.0 より下） */
  exposure: 2.2,
  /**
   * 夜の曇り・雨は固定露出を (1 + overcastBoost × 曇天) 倍にし、天候の露出の補正（EV）は夜らしさの分だけ弱める
   * （2.2 × 1.35 = 2.97 で上限 3.0 以内。月の光が雲に遮られて真っ暗になり、遊べなくなるのを防ぐ）
   */
  overcastBoost: 0.35,
  /** 星の明るさ（露出前）と大きさ（px） */
  stars: { brightness: 1.6, minSize: 1, maxSize: 2.6, seed: 7 },
  /** 夜の HUD の明るさ（不透明度の倍率。設定で無効にできる） */
  hudDim: 0.72,
} as const;

/** 霧・雨・夜の HUD: 敵のマーカーは索敵距離のこの割合より遠いと出さない（レーダーは出る） */
export const MARKER_RANGE_FACTOR = 0.6;

/** 曇天の空・直射光 */
export const OVERCAST_CONFIG = {
  /** overcast 1 で直射光を遮る割合 */
  directBlock: 0.9,
  /** 遮った直射光のうち空の光（雲の底の明るさ）になる割合 */
  diffuseTransfer: 0.45,
  /** 曇天の空の色（輝度 1 の倍率。わずかに青い灰色） */
  tint: [0.96, 1, 1.06] as const,
  /** 雲の層の上では曇天の灰色を消す（カメラの高さ m。from で 1 → to で 0） */
  aboveFrom: 1700,
  aboveTo: 2500,
  /**
   * 霧のスケールハイト（m。高いほど薄い）。7-A の事前修正で 1500 → 600m: 海面の濃さ（視程 1.5km）は同じで、
   * 上空（500m 以上）からは島の輪郭が見える
   */
  fogHeight: 600,
} as const;

/** 雨の粒（画質「中」以上は InstancedMesh、「低」は全画面の筋 1 枚） */
export const RAIN_CONFIG = {
  /** 落ちる速さ（m/s）と、風（強風 1 のとき）で流される速さ */
  fallSpeed: 9,
  windDrift: 6,
  /** カメラのまわりの箱（m）。粒はワールドに固定して箱の中に回り込ませる */
  box: { x: 90, y: 60, z: 90 },
  /** 筋の長さ = 相対速度 × shutter 秒（下限・上限 m）、幅（m。遠くは 1 画素を下回らないよう距離 × widthPerMeter まで太く） */
  shutter: 0.025,
  minLength: 0.5,
  maxLength: 7,
  width: 0.012,
  widthPerMeter: 0.0016,
  /** 不透明度（近く）と、消える距離 */
  alpha: 0.32,
  fadeDistance: 45,
  /** 雲の層より上では降らない（カメラの高さ m。from で 1 → to で 0） */
  ceilingFrom: 1500,
  ceilingTo: 1750,
  /** 「低」の全画面の筋: 不透明度と列の数 */
  sheet: { alpha: 0.13, columns: 70 },
  /** 海面の雨の波紋（画質「中」以上）: 格子の大きさ（m）と周期（秒）、傾きの強さ */
  ripple: { cell: 1.3, period: 0.9, slope: 0.35 },
} as const;

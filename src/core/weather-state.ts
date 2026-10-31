// 天候の状態（7-5。Three.js・DOM 非依存）: プリセット → 数値、3 秒の補間、時間の進行、太陽の通り道、
// 夜らしさ・HUD のマーカーの距離。描画への適用は src/render/weather/weather-view.ts
import {
  findWeather,
  MARKER_RANGE_FACTOR,
  NIGHT_CONFIG,
  SKY_KIND_CONFIG,
  SUN_PATH,
  SUN_TINT,
  TIME_OF_DAY_CONFIG,
  WEATHER_TIME,
  WIND_LEVEL_CONFIG,
  type TimeOfDay,
} from '../data/weather';

/** 補間できる天候の数値（プリセットはこの値の組） */
export interface WeatherParams {
  /** 時刻（0〜24）。太陽の向きはここから決まる */
  hour: number;
  overcast: number;
  coverage: number;
  cloudDark: number;
  /** 霧の消散係数（1/m、海面）。0 は霧なし */
  fog: number;
  haze: number;
  rain: number;
  /** 風（0 弱 〜 1 強） */
  wind: number;
  lowVisibility: number;
  exposureBias: number;
}

const TAU = Math.PI * 2;
const HOURS_PER_RADIAN = 24 / TAU;
const DAY = 24;

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 0〜24 に収める */
export function wrapHour(h: number): number {
  return ((h % DAY) + DAY) % DAY;
}

/** 時刻の太陽の仰角（度） */
export function sunElevationAt(hour: number): number {
  return SUN_PATH.maxElevation * Math.sin(((hour - 6) / DAY) * TAU);
}

/** 仰角（度）になる時刻。morning は 6〜12 時側、afternoon は 12〜18 時側（負の仰角は 18 時の後） */
export function hourForElevation(elevation: number, side: 'morning' | 'afternoon'): number {
  const a = Math.asin(Math.max(-1, Math.min(1, elevation / SUN_PATH.maxElevation)));
  return wrapHour(side === 'morning' ? 6 + a * HOURS_PER_RADIAN : 18 - a * HOURS_PER_RADIAN);
}

/** 時間帯の時刻 */
export function timeOfDayHour(time: TimeOfDay): number {
  const t = TIME_OF_DAY_CONFIG[time];
  return hourForElevation(t.elevation, t.side);
}

const DAY_HOUR = timeOfDayHour('day');

/** 時刻の太陽の方位（度。-Z から右回り）。昼の時間帯で 4-1 の方位になる */
export function sunAzimuthAt(hour: number): number {
  let d = wrapHour(hour) - DAY_HOUR;
  if (d > 12) d -= DAY;
  if (d < -12) d += DAY;
  return SUN_PATH.dayAzimuth + d * SUN_PATH.degreesPerHour;
}

/** プリセットの数値 */
export function presetParams(id: string, out?: WeatherParams): WeatherParams {
  const p = findWeather(id);
  const s = SKY_KIND_CONFIG[p.sky];
  const o = out ?? createWeatherParams();
  o.hour = timeOfDayHour(p.time);
  o.overcast = s.overcast;
  o.coverage = s.coverage;
  o.cloudDark = s.cloudDark;
  o.fog = s.visibility > 0 ? 3.0 / s.visibility : 0;
  o.haze = s.haze;
  o.rain = s.rain;
  o.wind = WIND_LEVEL_CONFIG[p.wind].value;
  o.lowVisibility = s.lowVisibility;
  o.exposureBias = s.exposureBias;
  return o;
}

export function createWeatherParams(): WeatherParams {
  return {
    hour: 12,
    overcast: 0,
    coverage: 0,
    cloudDark: 0,
    fog: 0,
    haze: 1,
    rain: 0,
    wind: 0,
    lowVisibility: 0,
    exposureBias: 0,
  };
}

export function copyWeather(src: Readonly<WeatherParams>, out: WeatherParams): WeatherParams {
  Object.assign(out, src);
  return out;
}

/**
 * a → b を t（0〜1）で補間する。時刻は 24 時間の輪の近い方を回る（太陽が通り道に沿って動く）。
 * 霧は消散係数ではなく視程の逆数のまま線形（どちらも 0 = 霧なしへ自然につながる）
 */
export function lerpWeather(
  a: Readonly<WeatherParams>,
  b: Readonly<WeatherParams>,
  t: number,
  out: WeatherParams,
): WeatherParams {
  const k = clamp01(t);
  const mix = (x: number, y: number): number => x + (y - x) * k;
  let dh = wrapHour(b.hour) - wrapHour(a.hour);
  if (dh > 12) dh -= DAY;
  if (dh < -12) dh += DAY;
  out.hour = wrapHour(a.hour + dh * k);
  out.overcast = mix(a.overcast, b.overcast);
  out.coverage = mix(a.coverage, b.coverage);
  out.cloudDark = mix(a.cloudDark, b.cloudDark);
  out.fog = mix(a.fog, b.fog);
  out.haze = mix(a.haze, b.haze);
  out.rain = mix(a.rain, b.rain);
  out.wind = mix(a.wind, b.wind);
  out.lowVisibility = mix(a.lowVisibility, b.lowVisibility);
  out.exposureBias = mix(a.exposureBias, b.exposureBias);
  return out;
}

/** 太陽の明るさの倍率（仰角で 0 → 1。夜は 0） */
export function sunWeight(elevation: number): number {
  const f = NIGHT_CONFIG.sunFade;
  return smoothstep(f.from, f.to, elevation);
}

/** 夜らしさ（0 昼 〜 1 夜）。月の明るさ・夜の固定露出・星・HUD の減光・マーカーに使う */
export function nightWeight(elevation: number): number {
  const f = NIGHT_CONFIG.nightFade;
  return smoothstep(f.from, f.to, elevation);
}

/** 視認性の悪さ（0〜1）: 霧・雨（lowVisibility）と夜の大きい方 */
export function lowVisibilityOf(p: Readonly<WeatherParams>): number {
  return Math.max(clamp01(p.lowVisibility), nightWeight(sunElevationAt(p.hour)));
}

/** HUD の敵のマーカーを出す最大距離（索敵距離 range のうち。霧・雨・夜は 60%） */
export function markerRange(range: number, lowVisibility: number): number {
  return range * (1 - (1 - MARKER_RANGE_FACTOR) * clamp01(lowVisibility));
}

/**
 * 天候の進み: プリセットを変えると今の値から 3 秒で補間する。時間が流れる（フリーフライトだけ）なら
 * 1 ゲーム日 = 10 実分で時刻を進める（補間中も補間先の時刻を進めるので途切れない）
 */
export class WeatherDirector {
  readonly current: WeatherParams;
  private readonly from: WeatherParams = createWeatherParams();
  private readonly to: WeatherParams = createWeatherParams();
  private elapsed = 0;
  private duration = 0;
  private presetId: string;
  private flowing = false;
  /** 前回の update から値が変わったか（描画側が重い計算をやり直すかの判断） */
  private dirty = true;

  constructor(
    initial: string,
    private readonly transitionSeconds: number = WEATHER_TIME.transitionSeconds,
    private readonly dayLengthSeconds: number = WEATHER_TIME.dayLengthSeconds,
  ) {
    this.presetId = findWeather(initial).id;
    this.current = presetParams(this.presetId);
    presetParams(this.presetId, this.to);
  }

  get preset(): string {
    return this.presetId;
  }

  get transitioning(): boolean {
    return this.elapsed < this.duration;
  }

  get timeFlow(): boolean {
    return this.flowing;
  }

  /** プリセットを変える。instant なら補間せずすぐ（同じプリセットでも時刻をプリセットの時刻に戻す） */
  set(id: string, instant = false): void {
    const next = findWeather(id).id;
    if (next === this.presetId && !instant && !this.flowing) return;
    this.presetId = next;
    presetParams(next, this.to);
    if (instant || this.transitionSeconds <= 0) {
      copyWeather(this.to, this.current);
      this.elapsed = this.duration = 0;
    } else {
      copyWeather(this.current, this.from);
      this.elapsed = 0;
      this.duration = this.transitionSeconds;
    }
    this.dirty = true;
  }

  /** 時間が流れるか（フリーフライトだけ ON にする。ミッション・PvP は固定） */
  setTimeFlow(on: boolean): void {
    this.flowing = on;
  }

  /** dt 秒進める（ポーズ中は呼ばない）。値が変わったら true */
  update(dt: number): boolean {
    if (this.flowing && dt > 0) {
      const dh = (dt / this.dayLengthSeconds) * DAY;
      this.to.hour = wrapHour(this.to.hour + dh);
      this.from.hour = wrapHour(this.from.hour + dh);
      if (!this.transitioning) this.current.hour = this.to.hour;
      this.dirty = true;
    }
    if (this.transitioning) {
      this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
      const t = smoothstep(0, 1, this.elapsed / this.duration);
      lerpWeather(this.from, this.to, t, this.current);
      this.dirty = true;
    }
    const changed = this.dirty;
    this.dirty = false;
    return changed;
  }
}

/**
 * 低い太陽の色味（輝度で正規化する前の RGB）。時刻が 12 時より前なら朝焼け、後なら夕焼けの色へ、
 * 仰角が低いほど寄せる（昼の高い太陽と夜は 1）
 */
export function sunTintAt(
  hour: number,
  out: [number, number, number] = [1, 1, 1],
): [number, number, number] {
  const el = sunElevationAt(hour);
  const t = SUN_TINT;
  const k = (1 - smoothstep(t.full, t.fade, el)) * smoothstep(-6, 0, el);
  const c = wrapHour(hour) < 12 ? t.dawn : t.dusk;
  for (let i = 0; i < 3; i++) out[i] = 1 + ((c[i] ?? 1) - 1) * k;
  return out;
}

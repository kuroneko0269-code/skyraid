// 音のパラメータ計算（4-4。Web Audio・DOM 非依存。テストあり）: スロットル → エンジンの音程と音量、速度 → 風切りのフィルタ、
// 警告の優先順位、ビープの点滅、距離減衰、画面 → BGM の曲、音量の範囲
import {
  AUDIO_CONFIG,
  ENGINE_SOUND,
  EXPLOSION_SOUNDS,
  LOCK_SOUND,
  SPATIAL_CONFIG,
  WARNING_KINDS,
  WARNING_SOUND,
  WIND_SOUND,
  type BgmTrack,
  type ExplosionSound,
  type WarningKind,
} from '../data/audio';
import type { ExplosionScale } from '../data/fx';
import type { ScreenState } from '../core/game-state';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 周波数は耳の感じ方に合わせて対数で補間する */
function lerpLog(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

export interface EngineParams {
  sawFreq: number;
  sawGain: number;
  noiseCutoff: number;
  noiseGain: number;
  /** アフターバーナーの高域ノイズの音量（0 = 消火） */
  afterburnerGain: number;
}

/** スロットル（0〜1）とアフターバーナーからエンジン音 */
export function engineParams(
  throttle: number,
  afterburner: boolean,
  out: EngineParams = { sawFreq: 0, sawGain: 0, noiseCutoff: 0, noiseGain: 0, afterburnerGain: 0 },
): EngineParams {
  const e = ENGINE_SOUND;
  const t = clamp01(throttle);
  const pitch = afterburner ? e.afterburner.pitch : 1;
  out.sawFreq = lerpLog(e.sawFreq.idle, e.sawFreq.full, t) * pitch;
  out.sawGain = lerp(e.sawGain.idle, e.sawGain.full, t);
  out.noiseCutoff = lerpLog(e.noiseCutoff.idle, e.noiseCutoff.full, t);
  out.noiseGain = lerp(e.noiseGain.idle, e.noiseGain.full, t);
  out.afterburnerGain = afterburner ? e.afterburner.gain : 0;
  return out;
}

export interface WindParams {
  cutoff: number;
  gain: number;
  q: number;
}

/** 速度（m/s）と失速の度合い（0〜1）から風切り音のバンドパス */
export function windParams(
  speed: number,
  stall: number,
  out: WindParams = { cutoff: 0, gain: 0, q: 0 },
): WindParams {
  const w = WIND_SOUND;
  const t = clamp01((speed - w.speed.low) / (w.speed.high - w.speed.low));
  const s = clamp01(stall);
  out.cutoff = lerpLog(w.cutoff.low, w.cutoff.high, t) * lerp(1, w.stall.cutoffScale, s);
  out.gain = lerp(w.gain.low, w.gain.high, t) + w.stall.gainAdd * s;
  out.q = lerp(w.q, w.stall.q, s);
  return out;
}

export function explosionSound(scale: ExplosionScale): ExplosionSound {
  return EXPLOSION_SOUNDS[scale];
}

export type WarningFlags = Readonly<Record<WarningKind, boolean>>;

/** 鳴らす警告（WARNING_KINDS の順で先のものを優先。無ければ null） */
export function pickWarning(flags: WarningFlags): WarningKind | null {
  for (const k of WARNING_KINDS) if (flags[k]) return k;
  return null;
}

/** 周期 1/hz のビープの鳴っている間か（周期の先頭から duty の割合だけ鳴る） */
export function beepOn(time: number, hz: number, duty: number): boolean {
  const phase = time * hz - Math.floor(time * hz);
  return phase < duty;
}

/** 警告音の周波数と、今鳴らすか */
export function warningTone(kind: WarningKind, time: number): { freq: number; on: boolean } {
  const t = WARNING_SOUND.tones[kind];
  return { freq: t.freq, on: beepOn(time, t.beepHz, WARNING_SOUND.duty) };
}

/** ロックオン音: 進行中（progress > 0）は 2Hz のビープ、完了は連続音。どちらでもなければ鳴らさない */
export function lockTone(
  progress: number,
  locked: boolean,
  time: number,
): { freq: number; on: boolean } {
  const c = LOCK_SOUND;
  if (locked) return { freq: c.lockedFreq, on: true };
  if (progress > 0) return { freq: c.freq, on: beepOn(time, c.beepHz, c.duty) };
  return { freq: c.freq, on: false };
}

/** PannerNode の距離減衰（inverse）と同じ式。カリングの判断とテスト用 */
export function distanceGain(distance: number): number {
  const c = SPATIAL_CONFIG;
  const d = Math.min(Math.max(distance, c.refDistance), c.maxDistance);
  return c.refDistance / (c.refDistance + c.rolloffFactor * (d - c.refDistance));
}

/** 音量の値を 0〜1 に（不正なら既定値） */
export function sanitizeVolume(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback;
}

/** マスターの実際の音量（ポーズ中は pausedVolume 倍。ミュートにはしない） */
export function masterGain(master: number, paused: boolean): number {
  return clamp01(master) * (paused ? AUDIO_CONFIG.pausedVolume : 1);
}

/** 画面 → BGM の曲。メニュー（タイトル〜ハンガー）は title、飛行とポーズは flight、リザルトは result */
export function bgmTrackFor(state: ScreenState): BgmTrack | null {
  switch (state) {
    case 'boot':
      return null;
    case 'flight':
    case 'pause':
      return 'flight';
    case 'result':
      return 'result';
    default:
      return 'title';
  }
}

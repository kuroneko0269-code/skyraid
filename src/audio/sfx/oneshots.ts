// 単発の合成効果音（4-4）: 機銃・ミサイル発射・爆発（規模 4 段階）・被弾・対空砲（砲声・フラック）・UI（タップ・決定・購入）。
// どれも VoicePool のボイス（フィルタ → 音量 →（パンナー →）効果音のバス）に、ノイズ（共有バッファ）とオシレーターをつないで鳴らす。
// pos を渡した音は 3D 配置（敵機・爆発・対空砲）、渡さない音は自機・UI（定位なし）
import {
  AAA_SOUND,
  GUN_SOUND,
  HIT_SOUND,
  MISSILE_SOUND,
  SPATIAL_CONFIG,
  UI_SOUND,
} from '../../data/audio';
import type { ExplosionScale } from '../../data/fx';
import type { AudioEngine } from '../engine';
import { explosionSound } from '../params';
import type { Voice } from '../voices';

export interface Position {
  x: number;
  y: number;
  z: number;
}

export type UiSoundKind = 'tap' | 'confirm' | 'purchase';

/** 指数減衰の下限（0 にはできない） */
const SILENT = 0.0001;

export class OneShots {
  constructor(
    private readonly engine: AudioEngine,
    /** リスナーの位置（遠すぎる音は鳴らさない） */
    private readonly listener: Readonly<Position>,
  ) {}

  gun(): void {
    this.gunShot(null, GUN_SOUND.gain);
  }

  enemyGun(pos: Readonly<Position>): void {
    this.gunShot(pos, GUN_SOUND.gain * GUN_SOUND.enemyGain);
  }

  missileLaunch(pos: Readonly<Position> | null): void {
    const c = MISSILE_SOUND;
    const v = this.voice(c.duration, pos);
    if (!v) return;
    const t = this.engine.now;
    v.filter.type = 'lowpass';
    v.filter.frequency.setValueAtTime(c.startCutoff, t);
    v.filter.frequency.exponentialRampToValueAtTime(c.endCutoff, t + c.duration);
    envelope(v, t, 0.02, c.gain, c.duration);
    this.noise(v, t, c.duration);
  }

  explosion(scale: ExplosionScale, pos: Readonly<Position> | null): void {
    const s = explosionSound(scale);
    const duration = Math.max(s.lowDecay, s.noiseDecay);
    this.boom(pos, s.lowStart, s.lowEnd, s.lowDecay, s.cutoff, s.noiseDecay, s.gain, duration);
  }

  aaaFire(pos: Readonly<Position>): void {
    const c = AAA_SOUND.fire;
    this.boom(pos, c.lowStart, c.lowEnd, c.decay, c.cutoff, c.decay, c.gain, c.decay);
  }

  flak(pos: Readonly<Position>): void {
    const c = AAA_SOUND.flak;
    this.boom(pos, c.lowStart, c.lowEnd, c.decay, c.cutoff, c.decay * 1.6, c.gain, c.decay * 1.6);
  }

  /** 自機の被弾: 金属的なクリック（矩形波）+ 短いノイズ（ハイパス） */
  hit(): void {
    const c = HIT_SOUND;
    const v = this.voice(c.noiseDuration, null);
    if (!v) return;
    const t = this.engine.now;
    v.filter.type = 'highpass';
    v.filter.frequency.setValueAtTime(c.noiseCutoff * 0.5, t);
    envelope(v, t, 0.002, c.gain, c.noiseDuration);
    this.noise(v, t, c.noiseDuration);
    const osc = this.osc(v, 'square', c.clickFreq, t, c.clickDuration);
    osc.frequency.exponentialRampToValueAtTime(c.clickEndFreq, t + c.clickDuration);
  }

  ui(kind: UiSoundKind): void {
    const c = UI_SOUND;
    if (kind === 'tap') {
      this.notes([c.tap.freq], 0, c.tap.duration, c.gain * 0.6, 'sine');
    } else if (kind === 'confirm') {
      this.notes(c.confirm.freqs, c.confirm.step, c.confirm.duration, c.gain, 'triangle');
    } else {
      this.notes(c.purchase.freqs, c.purchase.step, c.purchase.duration, c.gain, 'triangle');
    }
  }

  private gunShot(pos: Readonly<Position> | null, gain: number): void {
    const c = GUN_SOUND;
    const v = this.voice(c.duration, pos);
    if (!v) return;
    const t = this.engine.now;
    // ローパスなので低域のクリックもそのまま通る
    v.filter.type = 'lowpass';
    v.filter.frequency.setValueAtTime(c.noiseCutoff, t);
    v.filter.Q.setValueAtTime(c.noiseQ, t);
    envelope(v, t, 0.001, gain, c.duration);
    this.noise(v, t, c.duration);
    const osc = this.osc(v, 'sine', c.clickFreq, t, c.duration);
    osc.frequency.exponentialRampToValueAtTime(c.clickEndFreq, t + c.duration);
  }

  /** 低域のインパルス（サイン波の下降）+ ローパスのノイズの減衰 */
  private boom(
    pos: Readonly<Position> | null,
    lowStart: number,
    lowEnd: number,
    lowDecay: number,
    cutoff: number,
    noiseDecay: number,
    gain: number,
    duration: number,
  ): void {
    const v = this.voice(duration, pos);
    if (!v) return;
    const t = this.engine.now;
    v.filter.type = 'lowpass';
    v.filter.frequency.setValueAtTime(cutoff, t);
    v.filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.15), t + noiseDecay);
    envelope(v, t, 0.004, gain, duration);
    this.noise(v, t, noiseDecay);
    const osc = this.osc(v, 'sine', lowStart, t, lowDecay);
    osc.frequency.exponentialRampToValueAtTime(lowEnd, t + lowDecay);
  }

  /** 和音・分散和音（step 秒ずつずらす） */
  private notes(
    freqs: readonly number[],
    step: number,
    duration: number,
    gain: number,
    type: OscillatorType,
  ): void {
    const total = duration + step * (freqs.length - 1);
    const v = this.voice(total, null);
    if (!v) return;
    const t = this.engine.now;
    v.filter.type = 'lowpass';
    v.filter.frequency.setValueAtTime(8000, t);
    envelope(v, t, 0.004, gain, total);
    freqs.forEach((f, i) => this.osc(v, type, f, t + i * step, total - i * step));
  }

  private voice(duration: number, pos: Readonly<Position> | null): Voice | null {
    const pool = this.engine.voices;
    if (!pool) return null;
    if (pos) {
      const l = this.listener;
      const d = Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
      if (d > SPATIAL_CONFIG.cullDistance) return null;
    }
    return pool.acquire(duration, pos);
  }

  private noise(v: Voice, t: number, duration: number): void {
    const ctx = this.engine.ctx;
    const buffer = this.engine.noise;
    const pool = this.engine.voices;
    if (!ctx || !buffer || !pool) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // 毎回違う場所から読んで同じ音に聞こえないように
    const offset = Math.random() * Math.max(0, buffer.duration - duration);
    pool.attach(v, src);
    src.start(t, offset, duration + 0.02);
  }

  private osc(
    v: Voice,
    type: OscillatorType,
    freq: number,
    t: number,
    duration: number,
  ): OscillatorNode {
    const ctx = this.engine.ctx;
    const pool = this.engine.voices;
    if (!ctx || !pool) throw new Error('AudioEngine が使えるようになってから鳴らす');
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    pool.attach(v, o);
    o.start(t);
    o.stop(t + duration + 0.02);
    return o;
  }
}

/** 音量の包絡: attack 秒で peak へ、duration で SILENT まで指数減衰 */
function envelope(v: Voice, t: number, attack: number, peak: number, duration: number): void {
  const g = v.amp.gain;
  g.setValueAtTime(SILENT, t);
  g.exponentialRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  g.exponentialRampToValueAtTime(SILENT, t + Math.max(attack + 0.01, duration));
}

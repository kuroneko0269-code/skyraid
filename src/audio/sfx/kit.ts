// 単発の効果音の部品（4-4 の oneshots.ts から 4-12 で分けた）: ボイスを取る・ノイズ（共有バッファ）とオシレーターを鳴らす・
// 層（フィルタ → 音量。重ねる音ごとに別の音色と包絡）を作る。層のノードはボイスの extras に入れ、次にそのボイスを使うときに外す
import { SPATIAL_CONFIG } from '../../data/audio';
import type { AudioEngine } from '../engine';
import type { Voice } from '../voices';

export interface Position {
  x: number;
  y: number;
  z: number;
}

/** 指数減衰の下限（0 にはできない） */
export const SILENT = 0.0001;

/** 層: 音源をつなぐ入口のフィルタと、包絡を書く音量 */
export interface Layer {
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

export class SfxKit {
  constructor(
    readonly engine: AudioEngine,
    /** リスナーの位置（遠すぎる音は鳴らさない） */
    private readonly listener: Readonly<Position>,
  ) {}

  get now(): number {
    return this.engine.now;
  }

  voice(duration: number, pos: Readonly<Position> | null): Voice | null {
    const pool = this.engine.voices;
    if (!pool) return null;
    if (pos) {
      const l = this.listener;
      const d = Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
      if (d > SPATIAL_CONFIG.cullDistance) return null;
    }
    return pool.acquire(duration, pos);
  }

  /** ノイズを t から duration 秒（dest は層の入口。既定はボイスのフィルタ） */
  noise(v: Voice, t: number, duration: number, dest?: AudioNode): void {
    const ctx = this.engine.ctx;
    const buffer = this.engine.noise;
    const pool = this.engine.voices;
    if (!ctx || !buffer || !pool) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // 毎回違う場所から読んで同じ音に聞こえないように
    const offset = Math.random() * Math.max(0, buffer.duration - duration);
    pool.attach(v, src, dest);
    src.start(t, offset, duration + 0.02);
  }

  osc(
    v: Voice,
    type: OscillatorType,
    freq: number,
    t: number,
    duration: number,
    dest?: AudioNode,
  ): OscillatorNode {
    const ctx = this.engine.ctx;
    const pool = this.engine.voices;
    if (!ctx || !pool) throw new Error('AudioEngine が使えるようになってから鳴らす');
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    pool.attach(v, o, dest);
    o.start(t);
    o.stop(t + duration + 0.02);
    return o;
  }

  /**
   * 層（フィルタ type・周波数 freq・Q → 音量）をボイスのフィルタの手前に作る。音量は attack 秒で peak、
   * decay 秒で消える（t から）
   */
  layer(
    v: Voice,
    t: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    peak: number,
    attack: number,
    decay: number,
  ): Layer {
    const ctx = this.engine.ctx;
    if (!ctx) throw new Error('AudioEngine が使えるようになってから鳴らす');
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.setValueAtTime(q, t);
    const gain = ctx.createGain();
    decayEnvelope(gain.gain, t, attack, peak, decay);
    filter.connect(gain);
    gain.connect(v.filter);
    v.extras.push(filter, gain);
    return { filter, gain };
  }

  /** 重ねる音のボイス: フィルタは素通し（層がそれぞれ音色を持つ）、音量は gain のまま duration 秒（最後に消す） */
  open(v: Voice, t: number, gain: number, duration: number): void {
    v.filter.type = 'lowpass';
    v.filter.frequency.setValueAtTime(20000, t);
    const g = v.amp.gain;
    g.setValueAtTime(Math.max(SILENT, gain), t);
    g.setValueAtTime(Math.max(SILENT, gain), t + Math.max(0, duration - 0.02));
    g.exponentialRampToValueAtTime(SILENT, t + duration);
  }
}

/** 音量の包絡: attack 秒で peak へ、duration で SILENT まで指数減衰 */
export function envelope(
  v: Voice,
  t: number,
  attack: number,
  peak: number,
  duration: number,
): void {
  decayEnvelope(v.amp.gain, t, attack, peak, duration);
}

export function decayEnvelope(
  g: AudioParam,
  t: number,
  attack: number,
  peak: number,
  duration: number,
): void {
  g.setValueAtTime(SILENT, t);
  g.exponentialRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  g.exponentialRampToValueAtTime(SILENT, t + Math.max(attack + 0.01, duration));
}

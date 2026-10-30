// 戦闘の手応えの効果音（4-12）: 機銃の命中音・ミサイル発射（3 層 + ドップラー）・撃墜の「金属が裂ける」音。
// 数値は src/data/audio.ts の GUN_HIT_SOUND / MISSILE_SOUND / KILL_SOUND、ドップラーとコンプの式は ../params.ts
import { GUN_HIT_SOUND, KILL_SOUND, MISSILE_SOUND } from '../../data/audio';
import { missileSweep } from '../params';
import type { Voice } from '../voices';
import { SILENT, type Position, type SfxKit } from './kit';

export class CombatSounds {
  constructor(private readonly kit: SfxKit) {}

  /**
   * 機銃の命中音（定位なし）。gain はコンプの倍率（params.ts の hitCompression）を掛けた音量。
   * 金属の衝撃（200〜400Hz の部分音 + 300Hz の鋭いバンドパスのノイズ）+ 高域のクラック + 低域のドン
   */
  gunHit(gain: number): void {
    const c = GUN_HIT_SOUND;
    const k = this.kit;
    const v = k.voice(c.metal.decay, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.metal.decay);
    const m = c.metal;
    const ring = k.layer(v, t, 'bandpass', m.noiseFreq, m.noiseQ, m.noiseGain, 0.001, m.decay);
    k.noise(v, t, m.decay, ring.filter);
    const partials = k.layer(v, t, 'lowpass', 2000, 0.7, m.partialGain, 0.001, m.decay);
    for (const f of m.partials) k.osc(v, 'triangle', f, t, m.decay, partials.filter);
    const cr = c.crack;
    const crack = k.layer(v, t, 'highpass', cr.cutoff, 0.7, cr.gain, 0.0005, cr.duration);
    k.noise(v, t, cr.duration, crack.filter);
    this.thump(v, t, c.thump.startFreq, c.thump.endFreq, c.thump.duration, 300, c.thump.gain);
  }

  /** 低域のパルス（サイン波の下降。機銃の発射音の重さ・命中音のドン） */
  thump(
    v: Voice,
    t: number,
    startFreq: number,
    endFreq: number,
    duration: number,
    cutoff: number,
    gain: number,
  ): void {
    const k = this.kit;
    const l = k.layer(v, t, 'lowpass', cutoff, 0.7, gain, 0.002, duration);
    const o = k.osc(v, 'sine', startFreq, t, duration, l.filter);
    o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  }

  /**
   * ミサイル発射: 点火のクラック → 低域のうなり → 離れていくシュー（ローパスを閉じる）。うなりとシューの周波数は
   * ドップラーの倍率を掛けた折れ線（遠ざかるほど下がる）。pos は敵機のミサイル（位置つき）、null は自機
   */
  missileLaunch(pos: Readonly<Position> | null): void {
    const c = MISSILE_SOUND;
    const k = this.kit;
    const v = k.voice(c.duration, pos);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain, c.duration);
    const cr = c.crack;
    const crack = k.layer(v, t, 'highpass', cr.cutoff, 0.7, cr.gain, 0.0005, cr.duration);
    k.noise(v, t, cr.duration, crack.filter);
    const r = c.rumble;
    const rumble = k.layer(v, t, 'lowpass', r.cutoff, 0.8, r.gain, 0.01, r.decay);
    const saw = k.osc(v, 'sawtooth', r.startFreq, t, r.decay, rumble.filter);
    rampTo(saw.frequency, t, missileSweep(r.startFreq, r.endFreq, r.decay));
    const w = c.whoosh;
    const whoosh = k.layer(v, t, 'lowpass', w.startCutoff, w.q, w.gain, w.attack, c.duration);
    k.noise(v, t, c.duration, whoosh.filter);
    rampTo(whoosh.filter.frequency, t, missileSweep(w.startCutoff, w.endCutoff, c.duration));
  }

  /**
   * 撃墜の「金属が裂ける」音（定位なし。爆発の音に重ねる）: 下がっていくバンドパスのノイズを矩形波で刻む +
   * 不協和の鋸波 2 本の下降
   */
  kill(): void {
    const c = KILL_SOUND;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    const ctx = k.engine.ctx;
    const pool = k.engine.voices;
    if (!v || !ctx || !pool) return;
    const t = k.now;
    k.open(v, t, c.gain, c.duration);
    const tr = c.tear;
    const tear = k.layer(v, t, 'bandpass', tr.startFreq, tr.q, tr.gain, 0.004, c.duration);
    tear.filter.frequency.exponentialRampToValueAtTime(tr.endFreq, t + c.duration);
    k.noise(v, t, c.duration, tear.filter);
    // 刻み: 矩形波（±1）× depth を層の音量に足す
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(tr.gain * tr.ratchetDepth, t);
    depth.gain.exponentialRampToValueAtTime(SILENT, t + c.duration);
    depth.connect(tear.gain.gain);
    v.extras.push(depth);
    k.osc(v, 'square', tr.ratchetHz, t, c.duration, depth);
    const sc = c.screech;
    const screech = k.layer(v, t, 'bandpass', sc.cutoff, 1.5, sc.gain, 0.01, c.duration);
    for (const f of sc.freqs) {
      const o = k.osc(v, 'sawtooth', f, t, c.duration, screech.filter);
      o.frequency.exponentialRampToValueAtTime(f * sc.endRatio, t + sc.glide);
    }
  }
}

/** 周波数の折れ線（[時刻（t からの秒）, 値]）を指数ランプで書く。先頭は setValueAtTime */
function rampTo(p: AudioParam, t: number, points: readonly [number, number][]): void {
  points.forEach(([dt, value], i) => {
    if (i === 0) p.setValueAtTime(value, t);
    else p.exponentialRampToValueAtTime(value, t + dt);
  });
}

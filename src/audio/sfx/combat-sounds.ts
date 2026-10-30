// 戦闘の手応えの効果音（4-12）: 機銃の命中音 (a)・自機の被弾 (b)（4-12b）・ミサイル発射（3 層 + ドップラー）・
// 撃墜の「金属が裂ける」音。数値は src/data/audio.ts の GUN_HIT_SOUND / PLAYER_HIT_SOUND / MISSILE_SOUND / KILL_SOUND、
// ドップラーとコンプの式は ../params.ts
import {
  GUN_HIT_SOUND,
  KILL_SOUND,
  MISSILE_SOUND,
  PLAYER_HIT_SOUND,
  type ThumpSound,
} from '../../data/audio';
import { missileSweep } from '../params';
import type { Voice } from '../voices';
import { SILENT, type Position, type SfxKit } from './kit';

export class CombatSounds {
  constructor(private readonly kit: SfxKit) {}

  /**
   * 機銃の命中音 (a)（定位なし）。gain はコンプの倍率（params.ts の hitCompression）を掛けた音量。
   * 金属の衝撃（200〜400Hz の部分音 + 300Hz のバンドパスのノイズ）+ 高域のクラック + 低域のドン
   */
  gunHit(gain: number): void {
    const c = GUN_HIT_SOUND;
    const k = this.kit;
    const v = k.voice(Math.max(c.metal.decay, c.thump.duration), null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, Math.max(c.metal.decay, c.thump.duration));
    const m = c.metal;
    const ring = k.layer(v, t, 'bandpass', m.noiseFreq, m.noiseQ, m.noiseGain, 0.001, m.decay);
    k.noise(v, t, m.decay, ring.filter);
    const partials = k.layer(v, t, 'lowpass', 2000, 0.7, m.partialGain, 0.001, m.decay);
    for (const f of m.partials) k.osc(v, 'triangle', f, t, m.decay, partials.filter);
    const cr = c.crack;
    const crack = k.layer(v, t, 'highpass', cr.cutoff, 0.7, cr.gain, 0.0005, cr.duration);
    k.noise(v, t, cr.duration, crack.filter);
    this.thump(v, t, c.thump);
  }

  /**
   * 自機の被弾 (b)（4-12b。定位なし）: コックピットの中で聞く近い衝撃。強い低域 + 機体の共鳴 + 短いこもったノイズ
   */
  playerHit(): void {
    const c = PLAYER_HIT_SOUND;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain, c.duration);
    this.thump(v, t, c.impact);
    const h = c.hull;
    const hull = k.layer(v, t, 'bandpass', h.freq, h.q, h.gain, 0.002, h.decay);
    k.noise(v, t, h.decay, hull.filter);
    const mu = c.muffle;
    const muffle = k.layer(v, t, 'lowpass', mu.cutoff, 0.8, mu.gain, 0.001, mu.duration, mu.hold);
    k.noise(v, t, mu.duration, muffle.filter);
  }

  /** 低域のパルス（下降する周波数。機銃の発射音の重さ・命中音のドン・被弾の衝撃） */
  thump(v: Voice, t: number, c: ThumpSound): void {
    const k = this.kit;
    const l = k.layer(v, t, 'lowpass', c.cutoff, 0.7, c.gain, 0.002, c.duration, c.hold);
    const o = k.osc(v, c.wave, c.startFreq, t, c.duration, l.filter);
    o.frequency.exponentialRampToValueAtTime(c.endFreq, t + c.duration);
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

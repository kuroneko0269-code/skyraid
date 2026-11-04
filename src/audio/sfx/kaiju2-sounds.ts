// 9-6b: ネフィルガの効果音（合成。ネフィルガの遅延チャンク）: 羽ばたき・雷球の予兆と発射・突風の高まりと風・急降下の叫び・
// 尾の鞭・段階の叫び。部位の破壊はヴォルガスの音（KaijuSounds.partBreak）を使う。gain は距離の倍率（呼び出し側）。
// 数値は src/data/kaiju2-audio.ts
import { KAIJU2_SOUND as S } from '../../data/kaiju2-audio';
import type { SfxKit } from './kit';

export class Kaiju2Sounds {
  constructor(private readonly kit: SfxKit) {}

  flap(gain: number): void {
    const c = S.flap;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.duration);
    const l = k.layer(v, t, 'lowpass', c.cutoff, 0.9, 1, 0.12, c.duration);
    k.noise(v, t, c.duration, l.filter);
  }

  orbCharge(seconds: number, gain: number): void {
    const c = S.orbCharge;
    const k = this.kit;
    const v = k.voice(seconds, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, seconds);
    const l = k.layer(v, t, 'lowpass', c.cutoff, 1, 1, seconds * 0.9, seconds);
    const o = k.osc(v, 'sawtooth', c.from, t, seconds, l.filter);
    o.frequency.exponentialRampToValueAtTime(c.to, t + seconds);
    const cr = k.layer(v, t, 'highpass', c.crackle, 0.7, c.crackleGain, seconds * 0.8, seconds);
    k.noise(v, t, seconds, cr.filter);
  }

  orbLaunch(gain: number): void {
    const c = S.orbLaunch;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.duration);
    const l = k.layer(v, t, 'lowpass', 5000, 0.7, 1, 0.005, c.duration);
    const o = k.osc(v, 'square', c.from, t, c.duration, l.filter);
    o.frequency.exponentialRampToValueAtTime(c.to, t + c.duration);
    const n = k.layer(v, t, 'bandpass', 2400, 0.8, c.noiseGain, 0.005, c.duration * 0.6);
    k.noise(v, t, c.duration, n.filter);
  }

  gustCharge(seconds: number, gain: number): void {
    const c = S.gustCharge;
    const k = this.kit;
    const v = k.voice(seconds, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, seconds);
    const l = k.layer(v, t, 'bandpass', c.from, 0.9, 1, seconds * 0.9, seconds);
    l.filter.frequency.exponentialRampToValueAtTime(c.to, t + seconds);
    k.noise(v, t, seconds, l.filter);
  }

  gust(gain: number): void {
    const c = S.gust;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.duration);
    const l = k.layer(v, t, 'bandpass', c.from, c.q, 1, 0.04, c.duration, c.duration * 0.3);
    l.filter.frequency.exponentialRampToValueAtTime(c.to, t + c.duration);
    k.noise(v, t, c.duration, l.filter);
  }

  /** 叫び（急降下 dive・段階の変化と撃破 shout） */
  scream(kind: 'dive' | 'shout', gain: number): void {
    const c = S[kind];
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.duration);
    const l = k.layer(
      v,
      t,
      'bandpass',
      c.freqs[0] ?? 800,
      c.q,
      1,
      0.08,
      c.duration,
      c.duration * 0.4,
    );
    for (const f of c.freqs) {
      const o = k.osc(v, 'sawtooth', f, t, c.duration, l.filter);
      o.frequency.linearRampToValueAtTime(f * 1.05, t + c.duration * 0.25);
      o.frequency.exponentialRampToValueAtTime(f * c.end, t + c.duration);
    }
  }

  tail(gain: number): void {
    const c = S.tail;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.duration);
    const l = k.layer(v, t, 'highpass', c.cutoff, 0.8, 1, 0.002, c.duration);
    k.noise(v, t, c.duration, l.filter);
  }
}

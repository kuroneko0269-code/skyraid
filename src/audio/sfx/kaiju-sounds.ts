// 怪獣の効果音（6-2）: 足音（低域、歩くたび）・咆哮（低いうなり + 高域のきしみ）・熱線（予兆の高まりと持続ノイズ）・
// 部位破壊・ブレイク。すべて合成。巨大なので定位なしで鳴らし、音量を距離で下げる（gain は呼び出し側が掛ける）。
// 数値は src/data/audio.ts の KAIJU_SOUND
import { KAIJU_SOUND } from '../../data/audio';
import type { CombatSounds } from './combat-sounds';
import type { SfxKit } from './kit';

const S = KAIJU_SOUND;

export class KaijuSounds {
  constructor(
    private readonly kit: SfxKit,
    private readonly combat: CombatSounds,
  ) {}

  footstep(gain: number): void {
    const c = S.footstep;
    const k = this.kit;
    const v = k.voice(c.rumble.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, c.rumble.duration);
    this.combat.thump(v, t, c.thump);
    const r = k.layer(
      v,
      t,
      'lowpass',
      c.rumble.cutoff,
      0.7,
      c.rumble.gain,
      0.02,
      c.rumble.duration,
    );
    k.noise(v, t, c.rumble.duration, r.filter);
  }

  roar(gain: number): void {
    const c = S.roar;
    const k = this.kit;
    const d = c.duration;
    const v = k.voice(d, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, d);
    const g = c.growl;
    const growl = k.layer(v, t, 'lowpass', g.cutoff, 1.2, g.gain, 0.25, d, d * 0.45);
    for (const f of g.freqs) {
      const o = k.osc(v, 'sawtooth', f, t, d, growl.filter);
      o.frequency.linearRampToValueAtTime(f * 1.08, t + d * 0.3);
      o.frequency.exponentialRampToValueAtTime(f * g.endScale, t + d);
    }
    const s = c.screech;
    const screech = k.layer(v, t + 0.15, 'bandpass', s.freq, s.q, s.gain, 0.3, d - 0.15, d * 0.3);
    k.noise(v, t + 0.15, d - 0.15, screech.filter);
    screech.filter.frequency.linearRampToValueAtTime(s.freq * 0.7, t + d);
    const tone = k.layer(v, t + 0.2, 'lowpass', 4000, 0.7, s.toneGain, 0.2, d - 0.2, d * 0.3);
    const o = k.osc(v, 'square', s.tone, t + 0.2, d - 0.2, tone.filter);
    // きしみの揺れ（ビブラートの代わりに周波数を細かく上下させる）
    const steps = Math.floor((d - 0.2) * s.vibrato);
    for (let i = 1; i <= steps; i++)
      o.frequency.linearRampToValueAtTime(
        s.tone * (i % 2 === 0 ? 1.04 : 0.96),
        t + 0.2 + i / s.vibrato,
      );
  }

  /** 熱線の予兆（windup 秒で高まる） */
  beamCharge(windup: number, gain: number): void {
    const c = S.beam;
    const k = this.kit;
    const v = k.voice(windup, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, windup);
    const l = k.layer(v, t, 'lowpass', 2400, 0.7, c.charge.gain, windup * 0.9, windup);
    const o = k.osc(v, 'sawtooth', c.charge.from, t, windup, l.filter);
    o.frequency.exponentialRampToValueAtTime(c.charge.to, t + windup);
  }

  /** 熱線の照射（duration 秒の持続ノイズ） */
  beam(duration: number, gain: number): void {
    const c = S.beam;
    const k = this.kit;
    const v = k.voice(duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, duration);
    const hum = k.layer(
      v,
      t,
      'lowpass',
      c.hum.cutoff,
      1,
      c.hum.gain,
      0.05,
      duration,
      duration * 0.8,
    );
    k.osc(v, 'sawtooth', c.hum.freq, t, duration, hum.filter);
    k.noise(v, t, duration, hum.filter);
    const hiss = k.layer(
      v,
      t,
      'bandpass',
      c.hiss.freq,
      c.hiss.q,
      c.hiss.gain,
      0.05,
      duration,
      duration * 0.8,
    );
    k.noise(v, t, duration, hiss.filter);
  }

  partBreak(gain: number): void {
    const c = S.partBreak;
    const k = this.kit;
    const v = k.voice(Math.max(c.thump.duration, c.crunch.duration), null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain * gain, Math.max(c.thump.duration, c.crunch.duration));
    this.combat.thump(v, t, c.thump);
    const cr = k.layer(
      v,
      t,
      'lowpass',
      c.crunch.cutoff,
      0.6,
      c.crunch.gain,
      0.003,
      c.crunch.duration,
    );
    k.noise(v, t, c.crunch.duration, cr.filter);
  }

  breakChime(): void {
    const c = S.breakChime;
    const k = this.kit;
    const v = k.voice(c.duration, null);
    if (!v) return;
    const t = k.now;
    k.open(v, t, c.gain, c.duration);
    const l = k.layer(v, t, 'lowpass', 6000, 0.7, 0.5, 0.005, c.duration);
    c.freqs.forEach((f, i) => {
      k.osc(v, 'triangle', f, t + i * 0.05, c.duration - i * 0.05, l.filter);
    });
  }
}

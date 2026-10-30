// 単発の合成効果音（4-4）: 機銃・ミサイル発射・爆発（規模 4 段階）・被弾・対空砲（砲声・フラック）・UI（タップ・決定・購入）。
// 4-12 で機銃の命中音・撃墜の音を足し、ミサイル発射を 3 層に（sfx/combat-sounds.ts）。4-12b で被弾を作り直した。
// どれも VoicePool のボイス（フィルタ → 音量 →（パンナー →）効果音のバス）に、ノイズ（共有バッファ）とオシレーターをつないで鳴らす。
// pos を渡した音は 3D 配置（敵機・爆発・対空砲）、渡さない音は自機・UI（定位なし）
import { AAA_SOUND, GUN_SOUND, UI_SOUND } from '../../data/audio';
import type { ExplosionScale } from '../../data/fx';
import type { AudioEngine } from '../engine';
import { createHitCompressor, explosionSound, hitCompression } from '../params';
import type { Voice } from '../voices';
import { CombatSounds } from './combat-sounds';
import { SfxKit, envelope, type Position } from './kit';

export type { Position } from './kit';

export type UiSoundKind = 'tap' | 'confirm' | 'purchase';

export class OneShots {
  private readonly kit: SfxKit;
  private readonly combat: CombatSounds;
  private readonly hitComp = createHitCompressor();

  constructor(engine: AudioEngine, listener: Readonly<Position>) {
    this.kit = new SfxKit(engine, listener);
    this.combat = new CombatSounds(this.kit);
  }

  private get engine(): AudioEngine {
    return this.kit.engine;
  }

  gun(): void {
    this.gunShot(null, GUN_SOUND.gain);
  }

  enemyGun(pos: Readonly<Position>): void {
    this.gunShot(pos, GUN_SOUND.gain * GUN_SOUND.enemyGain);
  }

  missileLaunch(pos: Readonly<Position> | null): void {
    this.combat.missileLaunch(pos);
  }

  /** 自機の機銃が対象に当たった（命中音 (a)。4-12）。続けて当たるほど 1 発の音量を下げる（ソフトのコンプ。下限あり） */
  gunHit(): void {
    if (!this.engine.voices) return;
    const gain = hitCompression(this.hitComp, this.engine.now);
    if (gain > 0) this.combat.gunHit(gain);
  }

  /** 自機が敵側を撃墜した（4-12）: 金属が裂ける音 */
  kill(): void {
    this.combat.kill();
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

  /** 敵の弾が自機に当たった（被弾 (b)。4-12b）: コックピットで聞く近い衝撃 */
  hit(): void {
    this.combat.playerHit();
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
    const th = c.thump;
    const duration = Math.max(c.duration, th.duration);
    const v = this.voice(duration, pos);
    if (!v) return;
    const t = this.engine.now;
    // ノイズ + 低域のクリックは 4-4 のまま（ローパスなのでクリックもそのまま通る）。重さの低域パルスは別の層で長く（4-12b）
    this.kit.open(v, t, gain, duration);
    const burst = this.kit.layer(v, t, 'lowpass', c.noiseCutoff, c.noiseQ, 1, 0.001, c.duration);
    this.kit.noise(v, t, c.duration, burst.filter);
    const osc = this.osc(v, 'sine', c.clickFreq, t, c.duration, burst.filter);
    osc.frequency.exponentialRampToValueAtTime(c.clickEndFreq, t + c.duration);
    this.combat.thump(v, t, th);
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
    return this.kit.voice(duration, pos);
  }

  private noise(v: Voice, t: number, duration: number): void {
    this.kit.noise(v, t, duration);
  }

  private osc(
    v: Voice,
    type: OscillatorType,
    freq: number,
    t: number,
    duration: number,
    dest?: AudioNode,
  ): OscillatorNode {
    return this.kit.osc(v, type, freq, t, duration, dest);
  }
}

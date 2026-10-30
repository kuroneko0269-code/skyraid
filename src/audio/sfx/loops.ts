// 常時鳴る音（4-4）: エンジン・風切り・ロックオン・警告（同時発音の 16 のうち 4）。音源は作りっぱなしで、
// 音程と音量だけを変える。CPU を食わないよう、ノイズの音源 1 つをエンジン・アフターバーナー・風切りのフィルタで分け合い、
// パラメータは前回から変わったときだけ書く（setTargetAtTime でなめらかに）
import { AUDIO_CONFIG, ENGINE_SOUND, LOCK_SOUND, WARNING_SOUND } from '../../data/audio';
import type { AudioEngine } from '../engine';
import type { EngineParams, WindParams } from '../params';

/** 前回書いた値から rel 以上変わったら書く */
class SmoothParam {
  private last = Number.NaN;

  constructor(
    private readonly param: AudioParam,
    private readonly rel = 0.01,
  ) {}

  set(value: number, now: number): void {
    const last = this.last;
    if (Math.abs(value - last) <= Math.abs(last) * this.rel) return;
    this.last = value;
    this.param.setTargetAtTime(value, now, AUDIO_CONFIG.smoothing);
  }
}

export interface ToneState {
  freq: number;
  on: boolean;
}

export class FlightLoops {
  private readonly sawFreq: SmoothParam;
  private readonly sawGain: SmoothParam;
  private readonly noiseCutoff: SmoothParam;
  private readonly noiseGain: SmoothParam;
  private readonly abGain: SmoothParam;
  private readonly windCutoff: SmoothParam;
  private readonly windQ: SmoothParam;
  private readonly windGain: SmoothParam;
  private readonly lockFreq: SmoothParam;
  private readonly lockGain: AudioParam;
  private readonly warnFreq: SmoothParam;
  private readonly warnGain: AudioParam;
  private lockOn = false;
  private warnOn = false;

  constructor(private readonly engine: AudioEngine) {
    const ctx = engine.ctx;
    const bus = engine.sfx;
    if (!ctx || !bus || !engine.noise) throw new Error('AudioEngine が使えるようになってから作る');
    const gain = (to: AudioNode): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(to);
      return g;
    };
    const filter = (type: BiquadFilterType, freq: number, to: AudioNode): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.connect(to);
      return f;
    };

    // ノイズ 1 本をエンジン（ローパス）・アフターバーナー（ハイパス）・風切り（バンドパス）へ
    const noise = ctx.createBufferSource();
    noise.buffer = engine.noise;
    noise.loop = true;
    const noiseAmp = gain(bus);
    const noiseLp = filter('lowpass', ENGINE_SOUND.noiseCutoff.idle, noiseAmp);
    const abAmp = gain(bus);
    const abHp = filter('highpass', ENGINE_SOUND.afterburner.cutoff, abAmp);
    const windAmp = gain(bus);
    const windBp = filter('bandpass', 500, windAmp);
    noise.connect(noiseLp);
    noise.connect(abHp);
    noise.connect(windBp);
    noise.start();

    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = ENGINE_SOUND.sawFreq.idle;
    const sawAmp = gain(bus);
    saw.connect(filter('lowpass', ENGINE_SOUND.sawCutoff, sawAmp));
    saw.start();

    const lock = ctx.createOscillator();
    lock.type = 'sine';
    lock.frequency.value = LOCK_SOUND.freq;
    const lockAmp = gain(bus);
    lock.connect(lockAmp);
    lock.start();

    const warn = ctx.createOscillator();
    warn.type = 'square';
    const warnAmp = gain(bus);
    warn.connect(warnAmp);
    warn.start();

    this.sawFreq = new SmoothParam(saw.frequency);
    this.sawGain = new SmoothParam(sawAmp.gain);
    this.noiseCutoff = new SmoothParam(noiseLp.frequency);
    this.noiseGain = new SmoothParam(noiseAmp.gain);
    this.abGain = new SmoothParam(abAmp.gain);
    this.windCutoff = new SmoothParam(windBp.frequency);
    this.windQ = new SmoothParam(windBp.Q);
    this.windGain = new SmoothParam(windAmp.gain);
    this.lockFreq = new SmoothParam(lock.frequency, 0.001);
    this.lockGain = lockAmp.gain;
    this.warnFreq = new SmoothParam(warn.frequency, 0.001);
    this.warnGain = warnAmp.gain;
  }

  /** エンジンと風切り。active が false（撃墜中・メニュー）なら音量 0 */
  updateFlight(e: Readonly<EngineParams>, w: Readonly<WindParams>, active: boolean): void {
    const now = this.engine.now;
    const k = active ? 1 : 0;
    this.sawFreq.set(e.sawFreq, now);
    this.sawGain.set(e.sawGain * k, now);
    this.noiseCutoff.set(e.noiseCutoff, now);
    this.noiseGain.set(e.noiseGain * k, now);
    this.abGain.set(e.afterburnerGain * k, now);
    this.windCutoff.set(w.cutoff, now);
    this.windQ.set(w.q, now);
    this.windGain.set(w.gain * k, now);
  }

  /** ロックオンと警告のビープ（null は鳴らさない） */
  updateTones(lock: Readonly<ToneState> | null, warning: Readonly<ToneState> | null): void {
    const now = this.engine.now;
    if (lock) this.lockFreq.set(lock.freq, now);
    if (warning) this.warnFreq.set(warning.freq, now);
    this.lockOn = gate(this.lockGain, this.lockOn, lock?.on ?? false, LOCK_SOUND.gain, now);
    this.warnOn = gate(this.warnGain, this.warnOn, warning?.on ?? false, WARNING_SOUND.gain, now);
  }
}

/** ビープの入り切り（変わったときだけ。プチッと鳴らないよう 5ms でなめらかに） */
function gate(param: AudioParam, was: boolean, on: boolean, level: number, now: number): boolean {
  if (on !== was) param.setTargetAtTime(on ? level : 0, now, 0.005);
  return on;
}

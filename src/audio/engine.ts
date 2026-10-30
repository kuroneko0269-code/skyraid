// 音の基盤（4-4）: AudioContext は最初のユーザー操作で作る（ブラウザの自動再生の制限。iOS Safari は操作の中で resume して
// 無音を 1 回鳴らすまで音が出ない）。マスター / 効果音 / BGM の 3 本のゲイン。ポーズ中はミュートせずマスターを 30% に。
// タブが裏に回ったら suspend して止め、戻ったら resume する。単発の効果音は VoicePool（同時発音の上限つき）
import { AUDIO_CONFIG } from '../data/audio';
import { limiterMakeupCompensation, masterGain, sanitizeVolume } from './params';
import { VoicePool } from './voices';

export interface Volumes {
  master: number;
  sfx: number;
  bgm: number;
}

/** AudioContext を作る関数（テストではモックを渡す） */
export type ContextFactory = () => AudioContext | null;

interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

/** ブラウザの AudioContext（古い Safari は webkitAudioContext）。無ければ null */
export function browserContextFactory(): AudioContext | null {
  const w: AudioWindow = window;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

/** 音が使えるようになったとき（最初のユーザー操作）に呼ばれる。常時鳴る音・BGM はここで作る */
export type ReadyListener = (engine: AudioEngine) => void;

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'] as const;

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  bgm: GainNode | null = null;
  voices: VoicePool | null = null;
  /** 共有のホワイトノイズ（ループして使う） */
  noise: AudioBuffer | null = null;
  private readonly volumes: Volumes = { ...AUDIO_CONFIG.defaultVolumes };
  private paused = false;
  private hidden = false;
  private readonly readyListeners: ReadyListener[] = [];

  constructor(private readonly factory: ContextFactory) {}

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** 今の時刻（AudioContext の時間。作る前は 0） */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  onReady(fn: ReadyListener): void {
    this.readyListeners.push(fn);
    if (this.ctx) fn(this);
  }

  /** 最初のユーザー操作で unlock、タブの表示・非表示で resume / suspend する */
  attach(target: Window, doc: Document): void {
    const unlock = (): void => {
      this.unlock();
    };
    for (const type of UNLOCK_EVENTS)
      target.addEventListener(type, unlock, { capture: true, passive: true });
    doc.addEventListener('visibilitychange', () => {
      this.setHidden(doc.visibilityState === 'hidden');
    });
  }

  /**
   * ユーザー操作の中で呼ぶ: 初回は AudioContext とバスを作り、止まっていれば（iOS の中断・自動再生の制限）resume する
   */
  unlock(): void {
    if (this.hidden) return;
    if (!this.ctx) {
      const ctx = this.factory();
      if (!ctx) return;
      this.build(ctx);
      for (const fn of this.readyListeners) fn(this);
    }
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  }

  setVolumes(v: Readonly<Volumes>): void {
    const d = AUDIO_CONFIG.defaultVolumes;
    this.volumes.master = sanitizeVolume(v.master, d.master);
    this.volumes.sfx = sanitizeVolume(v.sfx, d.sfx);
    this.volumes.bgm = sanitizeVolume(v.bgm, d.bgm);
    this.applyGains();
  }

  getVolumes(): Readonly<Volumes> {
    return this.volumes;
  }

  /** ポーズ中はマスターを pausedVolume 倍（ミュートしない） */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.applyGains();
  }

  /** タブが裏に回ったら止める（戻ったら再開） */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  }

  /** リスナー（カメラ）の位置と向き（前方・上方向の単位ベクトル） */
  setListener(
    px: number,
    py: number,
    pz: number,
    fx: number,
    fy: number,
    fz: number,
    ux: number,
    uy: number,
    uz: number,
  ): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if ('positionX' in l) {
      l.positionX.value = px;
      l.positionY.value = py;
      l.positionZ.value = pz;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    } else {
      // 古い Safari（AudioParam を持たない）
      const old = l as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
      };
      old.setPosition(px, py, pz);
      old.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.bgm = ctx.createGain();
    // 効果音のバスの末尾にリミッター（4-11）。重なって 0dBFS を超えても割れない。しきい値より下の音量は変えない
    const l = AUDIO_CONFIG.limiter;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = l.thresholdDb;
    limiter.ratio.value = l.ratio;
    limiter.attack.value = l.attackSeconds;
    limiter.release.value = l.releaseSeconds;
    limiter.knee.value = l.kneeDb;
    const makeup = ctx.createGain();
    makeup.gain.value = limiterMakeupCompensation(l.thresholdDb, l.ratio);
    this.sfx.connect(limiter);
    limiter.connect(makeup);
    makeup.connect(this.master);
    this.bgm.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyGains(true);
    const c = AUDIO_CONFIG;
    this.voices = new VoicePool(ctx, this.sfx, c.maxVoices - c.loopVoices);
    this.noise = createNoiseBuffer(ctx, c.noiseSeconds);
    // iOS Safari: ユーザー操作の中で一度鳴らすと以後鳴るようになる（無音の 1 サンプル）
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silent.connect(ctx.destination);
    silent.start();
  }

  private applyGains(immediate = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfx || !this.bgm) return;
    const v = this.volumes;
    const set = (g: GainNode, value: number): void => {
      if (immediate) g.gain.value = value;
      else g.gain.setTargetAtTime(value, ctx.currentTime, AUDIO_CONFIG.smoothing);
    };
    set(this.master, masterGain(v.master, this.paused));
    set(this.sfx, v.sfx);
    set(this.bgm, v.bgm);
  }
}

/** ホワイトノイズのバッファ（モノラル） */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

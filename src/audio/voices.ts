// 単発の効果音のボイス（4-4）: フィルタ → 音量 →（PannerNode →）効果音のバス、のつながりをプールで使い回す。
// 足りなければ一番早く終わるボイスを止めて使う。音源（OscillatorNode / AudioBufferSourceNode）は Web Audio の仕様で
// 1 回しか start できないので鳴らすたびに作るが、ノイズのバッファは共有し、フィルタ・音量・パンナーは使い回す
import { SPATIAL_CONFIG } from '../data/audio';

export interface Voice {
  readonly filter: BiquadFilterNode;
  readonly amp: GainNode;
  readonly panner: PannerNode;
  /** 鳴り終わる時刻（AudioContext の時間） */
  endTime: number;
  positional: boolean;
  /** このボイスで鳴っている音源（盗まれたら止める） */
  readonly sources: AudioScheduledSourceNode[];
  /** 層ごとのフィルタ・音量（4-12。重ねる音）。次にこのボイスを使うときに外す */
  readonly extras: AudioNode[];
}

export class VoicePool {
  private readonly voices: Voice[] = [];
  /** 鳴らした回数・盗んだ回数（デバッグ・テスト用） */
  played = 0;
  stolen = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly bus: AudioNode,
    readonly size: number,
  ) {
    for (let i = 0; i < size; i++) {
      const filter = ctx.createBiquadFilter();
      const amp = ctx.createGain();
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = SPATIAL_CONFIG.refDistance;
      panner.rolloffFactor = SPATIAL_CONFIG.rolloffFactor;
      panner.maxDistance = SPATIAL_CONFIG.maxDistance;
      filter.connect(amp);
      amp.connect(bus);
      panner.connect(bus);
      this.voices.push({
        filter,
        amp,
        panner,
        endTime: 0,
        positional: false,
        sources: [],
        extras: [],
      });
    }
  }

  /** 今鳴っているボイスの数 */
  get active(): number {
    const now = this.ctx.currentTime;
    let n = 0;
    for (const v of this.voices) if (v.endTime > now) n++;
    return n;
  }

  /**
   * duration 秒鳴らすボイスを取る。pos があれば PannerNode でその位置に置く。
   * 空きがなければ一番早く終わるボイスの音源を止めて使う
   */
  acquire(duration: number, pos: { x: number; y: number; z: number } | null): Voice | null {
    const now = this.ctx.currentTime;
    let pick: Voice | null = null;
    for (const v of this.voices) {
      if (v.endTime <= now) {
        pick = v;
        break;
      }
      if (!pick || v.endTime < pick.endTime) pick = v;
    }
    if (!pick) return null;
    if (pick.endTime > now) {
      this.stolen++;
      for (const s of pick.sources) {
        try {
          s.stop();
        } catch {
          // まだ start していない・止まっている
        }
      }
    }
    pick.sources.length = 0;
    for (const n of pick.extras) n.disconnect();
    pick.extras.length = 0;
    pick.amp.gain.cancelScheduledValues(now);
    pick.filter.frequency.cancelScheduledValues(now);
    pick.filter.Q.cancelScheduledValues(now);
    pick.filter.Q.value = 1;
    const positional = pos !== null;
    if (positional !== pick.positional) {
      pick.amp.disconnect();
      pick.amp.connect(positional ? pick.panner : this.bus);
      pick.positional = positional;
    }
    if (pos) setPannerPosition(pick.panner, pos.x, pos.y, pos.z);
    pick.endTime = now + duration;
    this.played++;
    return pick;
  }

  /** 音源をボイスにつなぐ（既定はフィルタの入口。層の入口 dest も可）。鳴り終わったら外す */
  attach(
    voice: Voice,
    source: AudioScheduledSourceNode & AudioNode,
    dest: AudioNode = voice.filter,
  ): void {
    source.connect(dest);
    voice.sources.push(source);
    source.onended = () => {
      source.disconnect();
      const i = voice.sources.indexOf(source);
      if (i >= 0) voice.sources.splice(i, 1);
    };
  }
}

function setPannerPosition(p: PannerNode, x: number, y: number, z: number): void {
  if ('positionX' in p) {
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  } else {
    // 古い Safari
    (p as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}

// BGM の受け口（4-4）: public/audio/bgm/ に title.mp3 / flight.mp3 / result.mp3 があれば読み込んでループ再生し、
// 画面が変わったら 1 秒でクロスフェードする。無ければ無音。Cloudflare Pages は無いファイルに index.html を返すことがあるので、
// Content-Type が audio/* で、デコードできたものだけを使う。読み込みは音が使えるようになってから（最初のユーザー操作の後）
import { BGM_CONFIG, type BgmTrack } from '../data/audio';
import type { AudioEngine } from './engine';

interface Playing {
  track: BgmTrack;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export type BgmFetch = (url: string) => Promise<ArrayBuffer | null>;

/** ブラウザの fetch で読む。無い・音声でない・読めなければ null */
export async function fetchAudio(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('audio/')) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export class BgmPlayer {
  private readonly buffers = new Map<BgmTrack, AudioBuffer | null>();
  private wanted: BgmTrack | null = null;
  private playing: Playing | null = null;

  constructor(
    private readonly engine: AudioEngine,
    private readonly baseUrl: string,
    private readonly load: BgmFetch = fetchAudio,
  ) {
    engine.onReady(() => {
      for (const track of Object.keys(BGM_CONFIG.tracks) as BgmTrack[]) void this.loadTrack(track);
    });
  }

  /** その曲が読み込めたか（無ければ false。読み込み中も false） */
  has(track: BgmTrack): boolean {
    return (this.buffers.get(track) ?? null) !== null;
  }

  /** 流す曲を変える（null で止める）。同じなら何もしない。まだ読み込めていなければ読み込めたときに始める */
  play(track: BgmTrack | null): void {
    if (track === this.wanted) return;
    this.wanted = track;
    this.switchTo(track);
  }

  private async loadTrack(track: BgmTrack): Promise<void> {
    const ctx = this.engine.ctx;
    if (!ctx || this.buffers.has(track)) return;
    this.buffers.set(track, null);
    const data = await this.load(`${this.baseUrl}${BGM_CONFIG.tracks[track]}`);
    if (!data) return;
    try {
      this.buffers.set(track, await ctx.decodeAudioData(data));
    } catch {
      return;
    }
    if (this.wanted === track && this.playing?.track !== track) this.switchTo(track);
  }

  private switchTo(track: BgmTrack | null): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.bgm;
    if (!ctx || !bus) return;
    const fade = BGM_CONFIG.crossfade;
    const now = ctx.currentTime;
    const old = this.playing;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.source.stop(now + fade + 0.05);
      old.source.onended = () => {
        old.gain.disconnect();
      };
      this.playing = null;
    }
    const buffer = track ? (this.buffers.get(track) ?? null) : null;
    if (!track || !buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    source.connect(gain);
    gain.connect(bus);
    source.start(now);
    this.playing = { track, source, gain };
  }
}

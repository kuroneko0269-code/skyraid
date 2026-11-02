// シークのキーフレーム（7-B。Three.js・DOM 非依存）: 1 秒ごとに状態を写す。baseKeyframeSeconds ごとに丸ごと、間は
// 直前の丸ごとの写しとの差分（変わったオブジェクトだけ）にしてメモリを抑える。戻すときは丸ごと → 差分の順に書き戻す
import { REPLAY_CONFIG } from '../data/replay';
import { StateSnapshot, type WalkSkip } from './state-walk';

export class KeyframeStore {
  private readonly frames: StateSnapshot[] = [];
  private readonly baseEvery: number;

  constructor(
    private readonly roots: () => readonly object[],
    private readonly skip: WalkSkip,
    baseSeconds: number = REPLAY_CONFIG.baseKeyframeSeconds,
    readonly everySeconds: number = REPLAY_CONFIG.keyframeSeconds,
  ) {
    this.baseEvery = Math.max(1, Math.round(baseSeconds / everySeconds));
  }

  /** 撮ってあるキーフレームの数（0 番から続けて撮る） */
  get count(): number {
    return this.frames.length;
  }

  /** メモリの目安（写した値の数） */
  get size(): number {
    let n = 0;
    for (const f of this.frames) n += f.size;
    return n;
  }

  /** 次の番号（count 番）のキーフレームを今の状態で撮る */
  add(): void {
    const i = this.frames.length;
    const base = i % this.baseEvery === 0 ? undefined : this.frames[i - (i % this.baseEvery)];
    this.frames.push(StateSnapshot.take(this.roots(), this.skip, base));
  }

  /** i 番のキーフレームの状態に戻す */
  restore(i: number): void {
    const f = this.frames[i];
    if (!f) throw new Error(`Missing keyframe ${String(i)}`);
    const b = i - (i % this.baseEvery);
    if (b !== i) this.frames[b]?.restore();
    f.restore();
  }

  clear(): void {
    this.frames.length = 0;
  }
}

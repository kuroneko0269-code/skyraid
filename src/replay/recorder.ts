// リプレイの記録（7-B。Three.js・DOM 非依存）: シングルプレイの「初期状態 + 乱数のシード + 全ステップの入力 + 外部の操作」。
// 固定ステップ（60Hz）の判定は入力だけで決まる（src/replay/sim.ts）ので、これだけで同じ飛行を作り直せる。
// 1 ステップの入力はチャンネル（ピッチ・ロール・…）ごとの Int16 に貯め、保存のときに差分で縮める（src/replay/codec.ts）
import { REPLAY_CONFIG } from '../data/replay';
import {
  createFrame,
  FRAME_CHANNELS,
  type ReplayCommand,
  type ReplayControls,
  type ReplayData,
  type ReplayFrame,
  type ReplayHeader,
  type ReplayOutcome,
  type ReplayStart,
} from './types';

/** 記録の始めに決まる、初期状態以外の情報 */
export interface RecordMeta {
  readonly title: string;
  readonly pilotName: string;
  /** 記録した時刻（ISO 8601） */
  readonly date: string;
  /** 記録したゲームの版（8-7） */
  readonly gameVersion: string;
  /** 始めた直後の状態ハッシュ */
  readonly startHash: string;
  /** 操作の設定（9-2） */
  readonly controls?: ReplayControls;
}

/** 待ち時間なく伸ばせる Int16 の列 */
class GrowableInt16 {
  data = new Int16Array(3600);

  set(i: number, v: number): void {
    if (i >= this.data.length) {
      const next = new Int16Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[i] = v;
  }
}

export class ReplayRecorder {
  private start: ReplayStart | null = null;
  private meta: RecordMeta | null = null;
  private readonly channels = FRAME_CHANNELS.map(() => new GrowableInt16());
  private commandList: ReplayCommand[] = [];
  private count = 0;
  /** 毎ステップ書き換えて使う入れ物 */
  readonly frame: ReplayFrame = createFrame();

  /** 記録中か */
  get active(): boolean {
    return this.start !== null;
  }

  /** 記録したステップ数 */
  get steps(): number {
    return this.count;
  }

  get seconds(): number {
    return this.count / 60;
  }

  /** 記録を始める（前の記録は捨てる） */
  begin(start: ReplayStart, meta: RecordMeta): void {
    this.start = start;
    this.meta = meta;
    this.count = 0;
    this.commandList = [];
  }

  /** 1 ステップ分の入力を足す（判定を進める直前に呼ぶ） */
  push(f: Readonly<ReplayFrame>): void {
    if (!this.start) return;
    const i = this.count;
    FRAME_CHANNELS.forEach((k, c) => {
      this.channels[c]?.set(i, f[k]);
    });
    this.count++;
  }

  /** 外部の操作を足す（次のステップの前に効いたもの） */
  command(c: DistributiveOmit<ReplayCommand, 'step'>): void {
    if (!this.start) return;
    this.commandList.push({ ...c, step: this.count });
  }

  /** 今までの記録（記録は続ける）。短すぎる・記録していなければ null */
  snapshot(outcome: ReplayOutcome | null): ReplayData | null {
    const start = this.start;
    const meta = this.meta;
    if (!start || !meta) return null;
    const header: ReplayHeader = {
      ...start,
      ...meta,
      format: REPLAY_CONFIG.format,
      simVersion: REPLAY_CONFIG.simVersion,
      steps: this.count,
      outcome,
    };
    return {
      header,
      channels: this.channels.map((c) => c.data.slice(0, this.count)),
      commands: this.commandList.slice(),
    };
  }

  /** 記録を終える。記録を返す（記録していなければ null） */
  finish(outcome: ReplayOutcome | null): ReplayData | null {
    const data = this.snapshot(outcome);
    this.start = null;
    this.meta = null;
    return data;
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

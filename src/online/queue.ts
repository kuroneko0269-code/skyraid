// 送信できなかった記録の再送キュー（7-4、DOM・Supabase 非依存）。最大 20 件（超えたら古いものから捨てる）。
// 送るのは古い順。通信の失敗・レート制限で止まったらそこで打ち切って次の機会に。サーバーが拒否した（不正値・権限）ものは捨てる
import { ONLINE_CONFIG } from '../data/online';
import type { RecordInput } from './records';

/** 1 件の送信の結果。retry: 後で送り直す / drop: 二度と通らないので捨てる */
export type SendOutcome = 'sent' | 'retry' | 'drop';

export interface FlushResult {
  readonly sent: number;
  readonly dropped: number;
  readonly left: number;
}

export class RecordQueue {
  private items: RecordInput[];

  constructor(
    initial: readonly RecordInput[],
    /** 中身が変わったら呼ぶ（端末に保存する） */
    private readonly onChange: (items: readonly RecordInput[]) => void = () => undefined,
    private readonly max: number = ONLINE_CONFIG.queueMax,
  ) {
    this.items = initial.slice(-max);
  }

  get size(): number {
    return this.items.length;
  }

  get list(): readonly RecordInput[] {
    return this.items;
  }

  push(r: RecordInput): void {
    this.items.push(r);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    this.onChange(this.items);
  }

  /** 古い順に送る。retry が返ったらそこで止める（順番を保つ・連打しない） */
  async flush(send: (r: RecordInput) => Promise<SendOutcome>): Promise<FlushResult> {
    let sent = 0;
    let dropped = 0;
    while (this.items.length > 0) {
      const head = this.items[0];
      if (!head) break;
      const out = await send(head);
      if (out === 'retry') break;
      // 送っている間に増えた分は残す（先頭だけ外す）
      this.items.shift();
      if (out === 'sent') sent++;
      else dropped++;
      this.onChange(this.items);
    }
    return { sent, dropped, left: this.items.length };
  }
}

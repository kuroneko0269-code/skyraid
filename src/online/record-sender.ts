// 記録の送信と再送・ランキングのキャッシュ（7-4 の service.ts から分けた。DOM・Supabase 非依存）。
// 連携中で ON のときだけ動く。失敗した記録はキューに入れて、次の記録・起動・ログインのときに送り直す
import type { RecordKind } from '../data/online';
import {
  errorKind,
  type OnlineBackend,
  type OnlineErrorKind,
  type RankingQuery,
  type RankingRow,
} from './backend';
import { RecordQueue, type SendOutcome } from './queue';
import { RankingCache } from './ranking-cache';
import { checkRecord, type RecordInput } from './records';

/** 記録の送信の失敗 → 後で送り直すか捨てるか */
export function retryOutcome(kind: OnlineErrorKind): SendOutcome {
  return kind === 'invalid' || kind === 'denied' ? 'drop' : 'retry';
}

export class RecordSender {
  private readonly queue: RecordQueue;
  private readonly cache = new RankingCache();
  private flushing = false;

  constructor(
    private readonly backend: OnlineBackend,
    initial: readonly RecordInput[],
    onQueueChange: (items: readonly RecordInput[]) => void,
    /** 連携中かつ ON のユーザー id（それ以外は null = 送らない） */
    private readonly activeUser: () => string | null,
  ) {
    this.queue = new RecordQueue([...initial], onQueueChange);
  }

  get size(): number {
    return this.queue.size;
  }

  /** 不正値（事前チェック）と、連携していないときは送らない */
  submit(r: RecordInput): void {
    if (checkRecord(r) !== null) return;
    if (this.activeUser() === null) return;
    this.queue.push(r);
    void this.flush();
  }

  /** キューを古い順に送る */
  async flush(): Promise<void> {
    if (this.flushing || this.activeUser() === null) return;
    this.flushing = true;
    try {
      await this.queue.flush(async (r) => {
        if (this.activeUser() === null) return 'retry';
        try {
          await this.backend.insertRecord(r);
          this.cache.invalidate({ kind: r.kind, key: r.key, aircraftId: r.aircraftId });
          return 'sent';
        } catch (e) {
          return retryOutcome(errorKind(e));
        }
      });
    } finally {
      this.flushing = false;
    }
  }

  /** ランキング（5 分キャッシュ） */
  async ranking(q: RankingQuery): Promise<readonly RankingRow[]> {
    if (this.activeUser() === null) return [];
    return this.cache.get(q, (x) => this.backend.fetchRanking(x));
  }

  invalidate(kind: RecordKind, key: string, aircraftId?: string): void {
    this.cache.invalidate({ kind, key, aircraftId });
  }

  clearCache(): void {
    this.cache.clear();
  }
}

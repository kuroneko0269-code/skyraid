// 承認待ちの間の処理（7-4b、DOM・Supabase 非依存）:
// - PendingWatch: 承認待ちの間だけ、決めた間隔でトークンを取り直す（承認待ちでなくなったら止める）。間隔は pendingRecheckMs（5 分）
// - JoinTracker: 承認待ちになったら参加を申請する（同じユーザーでは 1 回だけ。失敗したら console に出し、画面に種類を出して、
//   次のトークンの更新・「承認を再確認」・起動でまた試す。7-4d）
import { errorKind, type OnlineBackend, type OnlineErrorKind } from './backend';
import type { JoinStatus } from './members';
import type { Timers } from './sync';

export class PendingWatch {
  private timer: unknown = null;

  constructor(
    private readonly timers: Timers,
    private readonly intervalMs: number,
    /** トークンを取り直す（失敗は中で握りつぶす） */
    private readonly recheck: () => Promise<void>,
    /** 今も承認待ちか */
    private readonly pending: () => boolean,
  ) {}

  get scheduled(): boolean {
    return this.timer !== null;
  }

  /** 状態が変わったら呼ぶ: 承認待ちなら次の回を予約し、そうでなければ止める */
  update(): void {
    if (!this.pending()) {
      if (this.timer !== null) this.timers.clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer !== null) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.recheck().finally(() => {
        this.update();
      });
    }, this.intervalMs);
  }
}

/** 申請の失敗（種類とサーバーの一言） */
export interface JoinFailure {
  readonly kind: OnlineErrorKind;
  readonly detail: string;
}

export class JoinTracker {
  private requestedFor: string | null = null;
  private current: JoinStatus | null = null;
  private failure: JoinFailure | null = null;

  constructor(
    private readonly backend: OnlineBackend,
    /** 申請に載せる表示名（パイロット名を整えたもの） */
    private readonly displayName: () => string,
    /** 申請の状態が分かった（画面を更新する） */
    private readonly changed: () => void,
  ) {}

  /** 申請の状態（読めていなければ null） */
  get status(): JoinStatus | null {
    return this.current;
  }

  /** 最後の申請の失敗（成功したら null） */
  get error(): JoinFailure | null {
    return this.failure;
  }

  /** ユーザーが変わった */
  reset(): void {
    this.requestedFor = null;
    this.current = null;
    this.failure = null;
  }

  /** userId で申請する。isCurrent: 返ってきたときにまだ同じユーザーか */
  async request(userId: string, isCurrent: (id: string) => boolean): Promise<void> {
    if (this.requestedFor === userId) return;
    this.requestedFor = userId;
    try {
      const status = await this.backend.requestJoin(this.displayName());
      if (!isCurrent(userId)) return;
      this.current = status;
      this.failure = null;
      this.changed();
    } catch (e) {
      // 握りつぶさない: console に出し、画面に種類を出す。同じユーザーなら次の機会にまた送る
      console.error('[skyraid] join request failed', e);
      if (this.requestedFor === userId) this.requestedFor = null;
      if (!isCurrent(userId)) return;
      this.failure = { kind: errorKind(e), detail: e instanceof Error ? e.message : String(e) };
      this.changed();
    }
  }
}

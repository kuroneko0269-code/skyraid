// セーブの同期（7-4、DOM・Supabase 非依存。サーバーは OnlineBackend 越し）。
// 保存イベント → 3 秒のデバウンス → 非同期に送る（失敗したら次の保存か次の起動で）。起動時とログイン時に受け取りを試す。
// 判定は sync-rules.ts。受け取ったセーブの反映と「どちらを使うか」のダイアログは、飛行中を避けて whenSafe で行う。
// どの処理も await で待つだけで、ゲームのフレームは止めない
import { ONLINE_CONFIG } from '../data/online';
import {
  OnlineError,
  errorKind,
  type OnlineBackend,
  type RemoteSave,
  type SaveRow,
} from './backend';
import type { OnlineMeta } from './meta';
import { decideSync, type SyncDecision } from './sync-rules';

/** セーブの読み書き（progression/save-store.ts をつなぐ） */
export interface SaveAccess {
  /** 今のセーブ（送る中身） */
  data(): unknown;
  /** このアプリのセーブの版 */
  readonly version: number;
  /** サーバーのセーブで置き換えて保存する。読めなければ false */
  apply(data: unknown): boolean;
  /** 置き換えた後に読み込み直す（ページの再読み込み） */
  reload(): void;
  /**
   * 端末のセーブがこのアプリより新しい版で、守っている（9-6a の事前修正）。true の間は送りも受け取りもしない
   * （送ると初期値でサーバーを上書きし、受け取ると端末の新しいセーブを古いもので上書きする）
   */
  locked?(): boolean;
}

export type ConflictChoice = 'local' | 'server' | null;

export interface SyncHooks {
  /** 両方に変更があるとき: どちらを使うか聞く（null は「あとで」） */
  ask(local: unknown, localAt: string | null, server: RemoteSave): Promise<ConflictChoice>;
  /** 飛行中を避けて fn を呼ぶ（メニューの間ならすぐ） */
  whenSafe(fn: () => void): void;
  /** 状態の一言（設定のオンライン連携に出す） */
  report(event: SyncEvent): void;
}

export type SyncEvent =
  'pushed' | 'pulled' | 'upToDate' | 'tooNew' | 'localTooNew' | 'tooLarge' | 'failed' | 'later';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): Date;
}

export const BROWSER_TIMERS: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => {
    if (typeof id === 'number') globalThis.clearTimeout(id);
  },
  now: () => new Date(),
};

/** JSON の大きさ（バイト。SQL の octet_length(data::text) とほぼ同じ） */
export function jsonBytes(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

export class SaveSync {
  /** 送受信中（同時に 2 つ走らせない） */
  private busy = false;
  /** 送受信中に来た依頼（終わったらすぐ続けて行う。pull は push を含む） */
  private rerun: 'push' | 'pull' | null = null;
  private timer: unknown = null;
  /** ローカルの変更の通し番号（送っている間に変わったかを見る） */
  private seq = 0;
  /** サーバーのセーブで置き換えている最中（その保存は変更として数えない） */
  private applying = false;

  constructor(
    private readonly backend: OnlineBackend,
    private readonly meta: OnlineMeta,
    private readonly storeMeta: () => void,
    private readonly save: SaveAccess,
    private readonly hooks: SyncHooks,
    /** 連携中かつオンライン連携が ON のユーザー id（それ以外は null = 何もしない） */
    private readonly activeUser: () => string | null,
    private readonly timers: Timers = BROWSER_TIMERS,
  ) {}

  /** ローカルのセーブが保存された（SaveStore.onPersist） */
  localChanged(): void {
    if (this.applying) return;
    this.seq++;
    this.meta.localDirty = true;
    this.meta.localUpdatedAt = this.timers.now().toISOString();
    this.storeMeta();
    this.schedulePush();
  }

  /** デバウンスして送る */
  schedulePush(): void {
    if (this.activeUser() === null) return;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.run('push');
    }, ONLINE_CONFIG.pushDebounceMs);
  }

  /** 起動時・ログイン時: サーバーと比べて、送る・受け取る・聞く */
  pull(): Promise<SyncDecision | null> {
    return this.run('pull');
  }

  private async run(mode: 'push' | 'pull'): Promise<SyncDecision | null> {
    if (this.busy) {
      if (this.rerun !== 'pull') this.rerun = mode;
      return null;
    }
    const user = this.activeUser();
    if (user === null) return null;
    if (this.save.locked?.() === true) {
      this.hooks.report('localTooNew');
      return null;
    }
    this.busy = true;
    try {
      return mode === 'push' ? await this.pushOrResolve(user) : await this.resolve(user);
    } catch {
      this.hooks.report('failed');
      return null;
    } finally {
      this.busy = false;
      const next = this.rerun;
      this.rerun = null;
      if (next) void this.run(next);
    }
  }

  /** 送る。サーバーが前回の同期の後に変わっていたら（conflict）比べ直す */
  private async pushOrResolve(user: string): Promise<SyncDecision | null> {
    // サーバーを正として受け取る約束のある間は送らない（7-4b）
    if (this.meta.preferServer) return this.resolve(user);
    if (!this.meta.localDirty && this.meta.syncedUser === user) return 'none';
    try {
      await this.push(user);
      return 'push';
    } catch (e) {
      if (errorKind(e) === 'conflict') return this.resolve(user);
      throw e;
    }
  }

  private async resolve(user: string): Promise<SyncDecision> {
    const info = await this.backend.fetchSaveInfo();
    const decision = decideSync(this.meta, user, info, this.save.version);
    if (decision === 'push' && this.meta.preferServer) {
      // サーバーにバックアップが無かった: 受け取るものが無いので、ふだんどおりローカルを送る
      this.meta.preferServer = false;
      this.storeMeta();
    }
    // サーバーに行が無い（他の端末でバックアップを消した: 7-4b）なら、同期の記録があっても新しく作る
    if (decision === 'push') await this.push(user, info === null);
    else if (decision === 'none') this.hooks.report('upToDate');
    else if (decision === 'tooNew') this.hooks.report('tooNew');
    else {
      // 受け取る・聞くときだけ本体を読む
      const server = await this.backend.fetchSave();
      if (!server) {
        // 版を読んだ直後に消えた（ふつうは起きない: delete の権限は無い）。次の機会に
        this.hooks.report('failed');
        return decision;
      }
      if (decision === 'pull') this.applyLater(user, server);
      else this.askLater(user, server);
    }
    return decision;
  }

  private async push(user: string, insert = false): Promise<void> {
    const data = this.save.data();
    if (jsonBytes(data) > ONLINE_CONFIG.saveMaxBytes) {
      this.hooks.report('tooLarge');
      return;
    }
    const row: SaveRow = { version: this.save.version, data };
    const seq = this.seq;
    const expected = !insert && this.meta.syncedUser === user ? this.meta.syncedServerAt : null;
    const info =
      expected === null
        ? await this.backend.insertSave(row)
        : await this.backend.updateSave(row, expected);
    this.meta.syncedUser = user;
    this.meta.syncedServerAt = info.updatedAt;
    // 送っている間にまた保存されたら、まだ未送信の変更がある
    if (this.seq === seq) this.meta.localDirty = false;
    this.storeMeta();
    this.hooks.report('pushed');
  }

  /** サーバーのセーブを反映する（飛行中なら飛行が終わってから）。反映したら読み込み直す */
  private applyLater(user: string, server: RemoteSave): void {
    this.hooks.whenSafe(() => {
      if (this.activeUser() !== user) return;
      this.applying = true;
      const ok = this.save.apply(server.data);
      this.applying = false;
      if (!ok) {
        this.hooks.report('failed');
        return;
      }
      this.meta.syncedUser = user;
      this.meta.syncedServerAt = server.updatedAt;
      this.meta.localDirty = false;
      this.meta.preferServer = false;
      this.storeMeta();
      this.hooks.report('pulled');
      this.save.reload();
    });
  }

  private askLater(user: string, server: RemoteSave): void {
    this.hooks.whenSafe(() => {
      void this.hooks
        .ask(this.save.data(), this.meta.localUpdatedAt, server)
        .then((choice) => this.choose(user, server, choice));
    });
  }

  /** ダイアログの答え。local: このサーバーの版の上にローカルを送る / server: 受け取る / null: 次の起動でまた聞く */
  async choose(user: string, server: RemoteSave, choice: ConflictChoice): Promise<void> {
    if (choice === null) {
      this.hooks.report('later');
      return;
    }
    if (choice === 'server') {
      this.applyLater(user, server);
      return;
    }
    this.meta.syncedUser = user;
    this.meta.syncedServerAt = server.updatedAt;
    this.meta.localDirty = true;
    this.meta.preferServer = false;
    this.storeMeta();
    await this.run('push');
  }

  /** サーバーのバックアップを消す（7-4b。連携中かつ ON のときだけ）。消したら同期の記録を捨てる */
  async deleteServer(): Promise<void> {
    if (this.activeUser() === null) throw new OnlineError('denied', 'not linked');
    await this.backend.deleteSave();
    this.forgetServer();
  }

  /** 同期の記録を捨て、次はローカルを新しく送る（insert） */
  private forgetServer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.meta.syncedUser = null;
    this.meta.syncedServerAt = null;
    this.meta.localDirty = true;
    this.meta.preferServer = false;
    this.storeMeta();
  }

  /** ローカルを初期化してサーバーを残す（7-4b）: 送信の予定を消し、次の同期でサーバーを受け取る */
  preferServerOnce(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.meta.preferServer = true;
    this.storeMeta();
  }
}

// オンライン連携のまとめ役（7-4、DOM・Supabase 非依存）: ログインの状態・オンライン連携の ON/OFF・セーブの同期・
// 記録の送信と再送・ランキングと表示名。状態は 未連携 / 承認待ち（ログイン済みだが app_metadata.apps に skyraid が無い）/
// 連携中 / エラー。OFF のときは送信・同期・ランキングをすべて止める（ログインは保持）
import type { RecordKind } from '../data/online';
import type { StorageLike } from '../core/settings';
import {
  errorKind,
  type OnlineBackend,
  type OnlineErrorKind,
  type OnlineUser,
  type RankingQuery,
  type RankingRow,
} from './backend';
import { loadMeta, storeMeta, type OnlineMeta } from './meta';
import { RecordQueue, type SendOutcome } from './queue';
import { RankingCache } from './ranking-cache';
import { checkRecord, type RecordInput } from './records';
import { SaveSync, type SaveAccess, type SyncHooks, type Timers, BROWSER_TIMERS } from './sync';
import { sanitizeDisplayName } from './format';

export const APP_NAME = 'skyraid';

export type OnlineState = 'signedOut' | 'pending' | 'linked' | 'error';

export interface OnlineStatus {
  readonly state: OnlineState;
  /** ログイン中のメール（本人にだけ表示） */
  readonly email: string | null;
  readonly userId: string | null;
  readonly enabled: boolean;
  /** エラーのときの種類 */
  readonly error: OnlineErrorKind | null;
}

export function hasAccess(user: OnlineUser): boolean {
  return user.apps.includes(APP_NAME);
}

/** 記録の送信の失敗 → 後で送り直すか捨てるか */
export function retryOutcome(kind: OnlineErrorKind): SendOutcome {
  return kind === 'invalid' || kind === 'denied' ? 'drop' : 'retry';
}

export class OnlineService {
  private user: OnlineUser | null = null;
  private error: OnlineErrorKind | null = null;
  private readonly meta: OnlineMeta;
  private readonly queue: RecordQueue;
  private readonly cache = new RankingCache();
  readonly sync: SaveSync;
  private readonly listeners: ((s: OnlineStatus) => void)[] = [];
  private flushing = false;
  /** サーバーの表示名（連携中に読む。無ければパイロット名で作る） */
  private name: string | null = null;

  constructor(
    private readonly backend: OnlineBackend,
    private readonly storage: StorageLike | null,
    save: SaveAccess,
    hooks: SyncHooks,
    /** プロフィールが無いときの表示名（パイロット名） */
    private readonly defaultName: () => string,
    timers: Timers = BROWSER_TIMERS,
  ) {
    this.meta = loadMeta(storage);
    this.queue = new RecordQueue(this.meta.queue, (items) => {
      this.meta.queue = [...items];
      this.persistMeta();
    });
    this.sync = new SaveSync(
      backend,
      this.meta,
      () => {
        this.persistMeta();
      },
      save,
      hooks,
      () => this.activeUserId,
      timers,
    );
  }

  /** 連携中かつ ON のときのユーザー id（送信・同期・ランキングをしてよい） */
  get activeUserId(): string | null {
    const u = this.user;
    return u && hasAccess(u) && this.meta.enabled ? u.id : null;
  }

  get status(): OnlineStatus {
    const u = this.user;
    let state: OnlineState = 'signedOut';
    if (this.error !== null) state = 'error';
    else if (u) state = hasAccess(u) ? 'linked' : 'pending';
    return {
      state,
      email: u?.email ?? null,
      userId: u?.id ?? null,
      enabled: this.meta.enabled,
      error: this.error,
    };
  }

  /** ランキングを出してよいか（モード選択の「ランキング」） */
  get rankingAvailable(): boolean {
    return this.activeUserId !== null;
  }

  /** 表示名（まだ読んでいなければ null） */
  get profileName(): string | null {
    return this.name;
  }

  get queued(): number {
    return this.queue.size;
  }

  onStatus(fn: (s: OnlineStatus) => void): void {
    this.listeners.push(fn);
  }

  /** 起動時: 端末に残ったログインを読み、ログイン・ログアウトを購読する */
  async start(): Promise<void> {
    this.backend.onAuthChange((u) => {
      const was = this.activeUserId;
      this.setUser(u);
      if (this.activeUserId !== null && this.activeUserId !== was) this.afterLinked();
    });
    try {
      this.setUser(await this.backend.currentUser());
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.activeUserId !== null) this.afterLinked();
  }

  async sendCode(email: string): Promise<void> {
    await this.backend.sendCode(email.trim());
  }

  /** コードでログインする。連携中になったら同期・再送（onAuthChange からも来るが、二重でも害はない） */
  async verifyCode(email: string, code: string): Promise<void> {
    const user = await this.backend.verifyCode(email.trim(), code);
    const was = this.activeUserId;
    this.setUser(user);
    if (this.activeUserId !== null && was !== this.activeUserId) this.afterLinked();
  }

  /** 承認待ちの「再確認」: トークンを取り直して app_metadata を読み直す */
  async recheck(): Promise<void> {
    try {
      const user = await this.backend.refresh();
      this.setUser(user);
      if (this.activeUserId !== null) this.afterLinked();
    } catch (e) {
      this.fail(e);
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.backend.signOut();
    } finally {
      this.cache.clear();
      this.setUser(null);
    }
  }

  /** 設定の「オンライン連携」ON/OFF。ON に戻したら同期と再送をやり直す */
  setEnabled(on: boolean): void {
    if (this.meta.enabled === on) return;
    this.meta.enabled = on;
    this.persistMeta();
    this.emit();
    if (on && this.activeUserId !== null) this.afterLinked();
  }

  /** ローカルのセーブが保存された（SaveStore.onPersist） */
  localSaved(): void {
    this.sync.localChanged();
  }

  /**
   * 記録を送る（レースのゴール・レイドのクリア・防衛戦の終わり）。不正値（事前チェック）は送らない。
   * 連携中で ON のときだけ。失敗したらキューに入れて、次の記録・起動・ログインのときに送り直す
   */
  submitRecord(r: RecordInput): void {
    if (checkRecord(r) !== null) return;
    if (this.activeUserId === null) return;
    this.queue.push(r);
    void this.flushQueue();
  }

  /** キューを古い順に送る */
  async flushQueue(): Promise<void> {
    if (this.flushing || this.activeUserId === null) return;
    this.flushing = true;
    try {
      await this.queue.flush(async (r) => {
        if (this.activeUserId === null) return 'retry';
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

  /** ランキング（5 分キャッシュ）。連携中で ON のときだけ */
  async ranking(q: RankingQuery): Promise<readonly RankingRow[]> {
    if (this.activeUserId === null) return [];
    return this.cache.get(q, (x) => this.backend.fetchRanking(x));
  }

  invalidateRanking(kind: RecordKind, key: string, aircraftId?: string): void {
    this.cache.invalidate({ kind, key, aircraftId });
  }

  /** 表示名を変える。整えた名前を返す（空なら null で何もしない） */
  async setDisplayName(name: string): Promise<string | null> {
    const clean = sanitizeDisplayName(name);
    if (clean === null || this.activeUserId === null) return null;
    await this.backend.saveDisplayName(clean);
    this.cache.clear();
    this.name = clean;
    this.emit();
    return clean;
  }

  /** 連携中になった: セーブを比べ、プロフィールが無ければパイロット名で作り、記録を送り直す */
  private afterLinked(): void {
    void this.sync.pull();
    void this.ensureProfile();
    void this.flushQueue();
  }

  private async ensureProfile(): Promise<void> {
    try {
      let name = await this.backend.fetchDisplayName();
      if (name === null) {
        name = sanitizeDisplayName(this.defaultName()) ?? 'PILOT';
        await this.backend.saveDisplayName(name);
      }
      this.name = name;
      this.emit();
    } catch {
      // 次のログインでまた試す
    }
  }

  private setUser(user: OnlineUser | null): void {
    if (user?.id !== this.user?.id) this.name = null;
    this.user = user;
    this.error = null;
    this.emit();
  }

  private fail(e: unknown): void {
    const kind = errorKind(e);
    // ログインが切れた（トークンが無効）は未連携に戻す
    if (kind === 'auth') {
      this.user = null;
      this.error = null;
    } else this.error = kind;
    this.emit();
  }

  private emit(): void {
    const s = this.status;
    for (const fn of this.listeners) fn(s);
  }

  private persistMeta(): void {
    storeMeta(this.storage, this.meta);
  }
}

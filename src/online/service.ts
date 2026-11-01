// オンライン連携のまとめ役（7-4、DOM・Supabase 非依存）: ログインの状態・オンライン連携の ON/OFF・セーブの同期・
// 記録の送信と再送・ランキングと表示名。状態は 未連携 / 承認待ち（ログイン済みだが app_metadata.apps に skyraid が無い）/
// 連携中 / エラー。OFF のときは送信・同期・ランキングをすべて止める（ログインは保持）。
// 7-4b: 承認待ちになったら参加を申請し、起動時と 5 分ごとにトークンを取り直して承認を自動で反映する。owner の判定。
// セーブのバックアップの削除・保持（設定の「セーブデータを削除」）は sync（SaveSync）の deleteServer / preferServerOnce
import { ONLINE_CONFIG, type RecordKind } from '../data/online';
import type { StorageLike } from '../core/settings';
import {
  errorKind,
  type OnlineBackend,
  type OnlineErrorKind,
  type OnlineUser,
  type RankingQuery,
  type RankingRow,
} from './backend';
import { sanitizeDisplayName } from './format';
import { isOwnerRole, type JoinStatus } from './members';
import { loadMeta, storeMeta, type OnlineMeta } from './meta';
import { JoinTracker, PendingWatch, type JoinFailure } from './pending-watch';
import { ProfileName, type PilotRenameResult } from './profile-name';
import { RecordSender } from './record-sender';
import type { RecordInput } from './records';
import { SaveSync, type SaveAccess, type SyncHooks, type Timers, BROWSER_TIMERS } from './sync';

export { retryOutcome } from './record-sender';

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
  /** app_metadata.roles.skyraid が owner（メンバー管理を出す。権限はサーバーが確かめる）。7-4b */
  readonly owner: boolean;
  /** 承認待ちのときの参加の申請の状態（読めていなければ null）。7-4b */
  readonly join: JoinStatus | null;
  /** 承認待ちのときの参加の申請の失敗（送れていれば null）。7-4d */
  readonly joinError: JoinFailure | null;
}

export function hasAccess(user: OnlineUser): boolean {
  return user.apps.includes(APP_NAME);
}

export class OnlineService {
  private user: OnlineUser | null = null;
  private error: OnlineErrorKind | null = null;
  private readonly meta: OnlineMeta;
  private readonly records: RecordSender;
  readonly sync: SaveSync;
  private readonly listeners: ((s: OnlineStatus) => void)[] = [];
  /** サーバーの表示名（連携中に読む。無ければパイロット名で作る。8-1 でパイロット名の変更も） */
  private readonly profile: ProfileName;
  private readonly watch: PendingWatch;
  private readonly join: JoinTracker;

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
    this.records = new RecordSender(
      backend,
      this.meta.queue,
      (items) => {
        this.meta.queue = [...items];
        this.persistMeta();
      },
      () => this.activeUserId,
    );
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
    this.profile = new ProfileName(
      backend,
      this.meta,
      () => {
        this.persistMeta();
      },
      () => this.activeUserId,
      defaultName,
      () => {
        this.records.clearCache();
        this.emit();
      },
    );
    this.watch = new PendingWatch(
      timers,
      ONLINE_CONFIG.pendingRecheckMs,
      () => this.refreshUser(true),
      () => this.status.state === 'pending',
    );
    this.join = new JoinTracker(
      backend,
      () => sanitizeDisplayName(this.defaultName()) ?? 'PILOT',
      () => {
        this.emit();
      },
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
      owner: u !== null && isOwnerRole(u.role),
      join: u !== null && !hasAccess(u) ? this.join.status : null,
      joinError: u !== null && !hasAccess(u) ? this.join.error : null,
    };
  }

  /** ランキングを出してよいか（モード選択の「ランキング」） */
  get rankingAvailable(): boolean {
    return this.activeUserId !== null;
  }

  /** 表示名（まだ読んでいなければ null） */
  get profileName(): string | null {
    return this.profile.name;
  }

  get queued(): number {
    return this.records.size;
  }

  /** 承認待ちの自動の再確認を予約しているか（テスト用） */
  get watchingPending(): boolean {
    return this.watch.scheduled;
  }

  onStatus(fn: (s: OnlineStatus) => void): void {
    this.listeners.push(fn);
  }

  /** 起動時: 端末に残ったログインを読み、ログイン・ログアウトを購読する */
  async start(): Promise<void> {
    this.backend.onAuthChange((u) => {
      this.changeUser(u);
    });
    try {
      this.setUser(await this.backend.currentUser());
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.activeUserId !== null) this.afterLinked();
    // 承認待ちなら、すぐ一度トークンを取り直す（離れている間に承認されていれば、そのまま連携中へ）
    else if (this.status.state === 'pending') await this.refreshUser(true);
  }

  async sendCode(email: string): Promise<void> {
    await this.backend.sendCode(email.trim());
  }

  /** コードでログインする。連携中になったら同期・再送（onAuthChange からも来るが、二重でも害はない） */
  async verifyCode(email: string, code: string): Promise<void> {
    this.changeUser(await this.backend.verifyCode(email.trim(), code));
  }

  /** 承認待ちの「再確認」: トークンを取り直して app_metadata を読み直す */
  recheck(): Promise<void> {
    return this.refreshUser(false);
  }

  async signOut(): Promise<void> {
    try {
      await this.backend.signOut();
    } finally {
      this.records.clearCache();
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

  /** 記録を送る（レースのゴール・レイドのクリア・防衛戦の終わり）。連携中で ON のときだけ */
  submitRecord(r: RecordInput): void {
    this.records.submit(r);
  }

  flushQueue(): Promise<void> {
    return this.records.flush();
  }

  ranking(q: RankingQuery): Promise<readonly RankingRow[]> {
    return this.records.ranking(q);
  }

  invalidateRanking(kind: RecordKind, key: string, aircraftId?: string): void {
    this.records.invalidate(kind, key, aircraftId);
  }

  /** 表示名を変える。整えた名前を返す（空なら null で何もしない） */
  setDisplayName(name: string): Promise<string | null> {
    return this.profile.setManual(name);
  }

  /**
   * 設定でパイロット名を変えた（8-1 の事前修正）: 承認済みでログイン中ならサーバーの表示名も変える。
   * 送れなければ（失敗・OFF）次に連携したときに送る
   */
  renameFromPilot(name: string): Promise<PilotRenameResult> {
    const u = this.user;
    return this.profile.renameFromPilot(name, u && hasAccess(u) ? u.id : null);
  }

  // ---- 内部

  /** トークンを取り直す。quiet（自動）なら通信の失敗は出さず次の回に任せる（ログインが切れたときだけ未連携に） */
  private async refreshUser(quiet: boolean): Promise<void> {
    try {
      this.changeUser(await this.backend.refresh());
    } catch (e) {
      if (!quiet || errorKind(e) === 'auth') this.fail(e);
    }
  }

  /** ユーザーが変わった。新しく連携中になったら同期・再送 */
  private changeUser(user: OnlineUser | null): void {
    const was = this.activeUserId;
    this.setUser(user);
    if (this.activeUserId !== null && was !== this.activeUserId) this.afterLinked();
  }

  /** 連携中になった: セーブを比べ、プロフィールが無ければパイロット名で作り、記録を送り直す */
  private afterLinked(): void {
    void this.sync.pull();
    void this.profile.ensure();
    void this.records.flush();
  }

  private setUser(user: OnlineUser | null): void {
    if (user?.id !== this.user?.id) {
      this.profile.name = null;
      this.join.reset();
    }
    this.user = user;
    this.error = null;
    this.emit();
    // 承認待ちになったら参加を申請し（もう申請していれば何もしない）、5 分ごとの再確認を始める
    if (user && !hasAccess(user)) void this.join.request(user.id, (id) => this.user?.id === id);
    this.watch.update();
  }

  private fail(e: unknown): void {
    const kind = errorKind(e);
    // ログインが切れた（トークンが無効）は未連携に戻す
    if (kind === 'auth') {
      this.user = null;
      this.error = null;
    } else this.error = kind;
    this.emit();
    this.watch.update();
  }

  private emit(): void {
    const s = this.status;
    for (const fn of this.listeners) fn(s);
  }

  private persistMeta(): void {
    storeMeta(this.storage, this.meta);
  }
}

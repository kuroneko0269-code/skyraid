// 7-4 のテストの道具: Supabase の代わりのモック（OnlineBackend）・手で進める時計・メモリの localStorage
import { vi } from 'vitest';
import {
  OnlineError,
  type OnlineBackend,
  type OnlineErrorKind,
  type OnlineUser,
  type RankingQuery,
  type RankingRow,
  type RemoteSave,
  type SaveRow,
} from '../src/online/backend';
import type { RecordInput } from '../src/online/records';
import type { RemoteSaveInfo } from '../src/online/sync-rules';
import type { Timers } from '../src/online/sync';

export const MEMBER: OnlineUser = {
  id: 'u1',
  email: 'pilot@example.com',
  apps: ['other', 'skyraid'],
};
export const STRANGER: OnlineUser = { id: 'u2', email: 'x@example.com', apps: ['other'] };

/** サーバーの代わり。saves は 1 行、records は配列。fail に入れた種類で次の呼び出しを失敗させる */
export class MockBackend implements OnlineBackend {
  user: OnlineUser | null = null;
  server: RemoteSave | null = null;
  records: RecordInput[] = [];
  names = new Map<string, string>();
  /** 次の insertRecord を失敗させる（先頭から 1 つずつ使う） */
  recordFailures: OnlineErrorKind[] = [];
  saveFailure: OnlineErrorKind | null = null;
  private clock = 0;
  private authListener: ((u: OnlineUser | null) => void) | null = null;
  readonly calls = { insertSave: 0, updateSave: 0, fetchSave: 0, fetchSaveInfo: 0 };
  rankingRows: RankingRow[] = [];
  /** 呼ばれた条件は mock.calls で見る */
  readonly queries: RankingQuery[] = [];
  fetchRanking = vi.fn((q: RankingQuery): Promise<RankingRow[]> => {
    this.queries.push(q);
    return Promise.resolve(this.rankingRows);
  });

  private stamp(): string {
    this.clock++;
    return new Date(Date.UTC(2026, 10, 1, 0, 0, this.clock)).toISOString();
  }

  /** 他の端末が送ったことにする */
  remoteWrite(data: unknown, version = 8): void {
    this.server = { version, data, updatedAt: this.stamp() };
  }

  currentUser(): Promise<OnlineUser | null> {
    return Promise.resolve(this.user);
  }
  onAuthChange(fn: (user: OnlineUser | null) => void): void {
    this.authListener = fn;
  }
  emitAuth(u: OnlineUser | null): void {
    this.user = u;
    this.authListener?.(u);
  }
  sendCode(): Promise<void> {
    return Promise.resolve();
  }
  verifyCode(_email: string, code: string): Promise<OnlineUser> {
    if (code !== '123456') return Promise.reject(new OnlineError('code', 'bad'));
    this.user = MEMBER;
    return Promise.resolve(MEMBER);
  }
  refresh(): Promise<OnlineUser | null> {
    return Promise.resolve(this.user);
  }
  signOut(): Promise<void> {
    this.user = null;
    return Promise.resolve();
  }
  fetchSaveInfo(): Promise<RemoteSaveInfo | null> {
    this.calls.fetchSaveInfo++;
    const s = this.server;
    return Promise.resolve(s ? { version: s.version, updatedAt: s.updatedAt } : null);
  }
  fetchSave(): Promise<RemoteSave | null> {
    this.calls.fetchSave++;
    return Promise.resolve(this.server);
  }
  insertSave(row: SaveRow): Promise<RemoteSaveInfo> {
    this.calls.insertSave++;
    if (this.saveFailure) return Promise.reject(new OnlineError(this.saveFailure, 'x'));
    if (this.server) return Promise.reject(new OnlineError('conflict', 'exists'));
    this.server = {
      version: row.version,
      data: structuredClone(row.data),
      updatedAt: this.stamp(),
    };
    return Promise.resolve(this.server);
  }
  updateSave(row: SaveRow, expectedAt: string): Promise<RemoteSaveInfo> {
    this.calls.updateSave++;
    if (this.saveFailure) return Promise.reject(new OnlineError(this.saveFailure, 'x'));
    if (this.server?.updatedAt !== expectedAt)
      return Promise.reject(new OnlineError('conflict', 'changed'));
    this.server = {
      version: row.version,
      data: structuredClone(row.data),
      updatedAt: this.stamp(),
    };
    return Promise.resolve(this.server);
  }
  insertRecord(r: RecordInput): Promise<void> {
    const f = this.recordFailures.shift();
    if (f) return Promise.reject(new OnlineError(f, 'x'));
    this.records.push(r);
    return Promise.resolve();
  }
  fetchDisplayName(): Promise<string | null> {
    return Promise.resolve(this.user ? (this.names.get(this.user.id) ?? null) : null);
  }
  saveDisplayName(name: string): Promise<void> {
    if (this.user) this.names.set(this.user.id, name);
    return Promise.resolve();
  }
}

/** 手で進めるタイマー */
export class ManualTimers implements Timers {
  private t = Date.UTC(2026, 10, 1, 1, 0, 0);
  private next = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.tasks.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: unknown): void {
    if (typeof id === 'number') this.tasks.delete(id);
  }
  now(): Date {
    return new Date(this.t);
  }
  get pending(): number {
    return this.tasks.size;
  }
  /** ms 進めて、時刻の来たタスクを呼ぶ */
  advance(ms: number): void {
    this.t += ms;
    for (const [id, task] of [...this.tasks]) {
      if (task.at <= this.t) {
        this.tasks.delete(id);
        task.fn();
      }
    }
  }
}

export class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

/** 待ちの Promise を流し切る */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

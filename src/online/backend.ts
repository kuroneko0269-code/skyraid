// サーバーとのやり取りの窓口（7-4）。本物は supabase-backend.ts（@supabase/supabase-js）、テストはモックに差し替える
import type { RecordKind } from '../data/online';
import type { RecordDetail, RecordInput } from './records';
import type { RemoteSaveInfo } from './sync-rules';

export interface OnlineUser {
  readonly id: string;
  /** 本人にだけ見せる（承認待ちの案内）。テーブルには保存しない */
  readonly email: string;
  /** app_metadata.apps（管理者だけが書き換えられる。規約 3.3） */
  readonly apps: readonly string[];
}

export interface RemoteSave extends RemoteSaveInfo {
  readonly data: unknown;
}

export interface SaveRow {
  readonly version: number;
  readonly data: unknown;
}

/** ランキングの 1 行（ビューの列） */
export interface RankingRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly aircraftId: string;
  readonly valueMs: number;
  readonly detail: RecordDetail;
  readonly createdAt: string;
  readonly place: number;
}

export interface RankingQuery {
  readonly kind: RecordKind;
  readonly key: string;
  /** レースだけ（コース × 機体） */
  readonly aircraftId?: string;
}

/**
 * 失敗の種類。network: つながらない / auth: ログインが切れた / denied: 権限がない（承認待ち・RLS）/
 * invalid: サーバーの check に通らない / rate: レート制限 / conflict: サーバーのセーブが先に変わっていた / unknown
 */
export type OnlineErrorKind =
  'network' | 'auth' | 'denied' | 'invalid' | 'rate' | 'conflict' | 'code' | 'unknown';

export class OnlineError extends Error {
  constructor(
    readonly kind: OnlineErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'OnlineError';
  }
}

export function errorKind(e: unknown): OnlineErrorKind {
  return e instanceof OnlineError ? e.kind : 'unknown';
}

export interface OnlineBackend {
  /** 今のログイン（端末に残ったセッション）。無ければ null */
  currentUser(): Promise<OnlineUser | null>;
  /** ログイン・ログアウト・トークンの更新 */
  onAuthChange(fn: (user: OnlineUser | null) => void): void;
  /** 6 桁のコードをメールで送る */
  sendCode(email: string): Promise<void>;
  /** コードでログインする */
  verifyCode(email: string, code: string): Promise<OnlineUser>;
  /** トークンを取り直す（承認された app_metadata を反映する） */
  refresh(): Promise<OnlineUser | null>;
  signOut(): Promise<void>;

  /** 版と更新日時だけ（起動のたびに読む。本体は受け取るときだけ: 転送量の上限を守る） */
  fetchSaveInfo(): Promise<RemoteSaveInfo | null>;
  fetchSave(): Promise<RemoteSave | null>;
  /** 新しく作る。もうあれば conflict */
  insertSave(row: SaveRow): Promise<RemoteSaveInfo>;
  /** サーバーの updated_at が expectedAt のときだけ書く。変わっていれば conflict */
  updateSave(row: SaveRow, expectedAt: string): Promise<RemoteSaveInfo>;

  insertRecord(r: RecordInput): Promise<void>;
  fetchRanking(q: RankingQuery): Promise<RankingRow[]>;

  fetchDisplayName(): Promise<string | null>;
  saveDisplayName(name: string): Promise<void>;
}

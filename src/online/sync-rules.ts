// セーブの同期の判定（7-4、DOM・Supabase 非依存）。ローカルのセーブが正で、サーバーはバックアップ。
// 「最後に同期したときのサーバーの updated_at」と「その後にローカルが変わったか」で、どちらに変更があるかを見る:
//  1. サーバーに無い                         → 送る（push）
//  2. サーバーは前回のまま・ローカルだけ変更 → 送る（push）。どちらも変わっていなければ何もしない（none）
//  3. サーバーだけ変更（他の端末で遊んだ）   → 受け取る（pull。updated_at の新しいサーバーを採用）
//  4. 両方に変更                             → どちらを使うか聞く（ask）
// サーバーのセーブの版がこのアプリより新しいときは受け取らない（tooNew: 読むと壊れたセーブ扱いで初期化されるため）
// 7-4b: ローカルを初期化してサーバーのバックアップを残した直後（preferServer）は、サーバーにあれば必ず受け取る
import type { OnlineMeta } from './meta';

export interface RemoteSaveInfo {
  readonly version: number;
  readonly updatedAt: string;
}

export type SyncDecision = 'push' | 'pull' | 'ask' | 'none' | 'tooNew';

export function decideSync(
  meta: Pick<OnlineMeta, 'syncedUser' | 'syncedServerAt' | 'localDirty'> &
    Partial<Pick<OnlineMeta, 'preferServer'>>,
  userId: string,
  server: RemoteSaveInfo | null,
  appSaveVersion: number,
): SyncDecision {
  if (server === null) return 'push';
  if (meta.preferServer === true) return server.version > appSaveVersion ? 'tooNew' : 'pull';
  // 別のユーザー（またはこの端末で初めて）: 同期の記録が無いので、ローカルは未送信の変更があるとみなす
  const sameUser = meta.syncedUser === userId;
  const serverChanged = !sameUser || meta.syncedServerAt !== server.updatedAt;
  const localChanged = !sameUser || meta.localDirty;
  if (!serverChanged) return localChanged ? 'push' : 'none';
  if (server.version > appSaveVersion) return 'tooNew';
  return localChanged ? 'ask' : 'pull';
}

/** 時刻の新しい方（ダイアログで「新しい」の印を付ける）。どちらかが読めなければ null */
export function newerSide(localAt: string | null, serverAt: string): 'local' | 'server' | null {
  if (localAt === null) return 'server';
  const l = Date.parse(localAt);
  const s = Date.parse(serverAt);
  if (Number.isNaN(l) || Number.isNaN(s)) return null;
  return l > s ? 'local' : 'server';
}

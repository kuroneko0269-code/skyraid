// 端末に残すオンライン連携の状態（7-4、DOM・Supabase 非依存）: localStorage の skyraid.online に JSON 1 つ。
// セーブ（skyraid.save）とは別にする: セーブはサーバーへ送る中身で、この状態（同期の記録・送信待ち）は端末ごとのもの
import { ONLINE_CONFIG } from '../data/online';
import type { StorageLike } from '../core/settings';
import { checkRecord, isRecordKind, type RecordDetail, type RecordInput } from './records';

export interface OnlineMeta {
  /** 設定の「オンライン連携」。OFF なら送信・同期・ランキングを止める（ログインは保持） */
  enabled: boolean;
  /** 最後に同期したユーザー（別のユーザーでログインしたら同期の記録を使わない） */
  syncedUser: string | null;
  /** 最後に同期した（送った・受け取った）ときのサーバーの updated_at */
  syncedServerAt: string | null;
  /** 最後の同期の後にローカルのセーブが変わったか */
  localDirty: boolean;
  /** ローカルのセーブを最後に保存した時刻（ISO。競合のダイアログに出す） */
  localUpdatedAt: string | null;
  /** 送信待ちの記録（古い順。最大 20） */
  queue: RecordInput[];
}

export function createMeta(): OnlineMeta {
  return {
    enabled: true,
    syncedUser: null,
    syncedServerAt: null,
    localDirty: true,
    localUpdatedAt: null,
    queue: [],
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function parseDetail(v: unknown): RecordDetail {
  const out: Record<string, string | number | boolean> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = x;
  }
  return out;
}

function parseRecord(v: unknown): RecordInput | null {
  if (typeof v !== 'object' || v === null) return null;
  const o: Record<string, unknown> = { ...v };
  const r = {
    kind: o.kind,
    key: str(o.key) ?? '',
    aircraftId: str(o.aircraftId) ?? '',
    valueMs: typeof o.valueMs === 'number' ? o.valueMs : NaN,
    detail: parseDetail(o.detail),
    clientVersion: str(o.clientVersion) ?? '',
  };
  if (!isRecordKind(r.kind)) return null;
  const rec: RecordInput = { ...r, kind: r.kind };
  return checkRecord(rec) === null ? rec : null;
}

/** 読む。無い・壊れている・アクセスできないときは初期値 */
export function loadMeta(storage: StorageLike | null): OnlineMeta {
  const meta = createMeta();
  let text: string | null;
  try {
    text = storage?.getItem(ONLINE_CONFIG.storageKey) ?? null;
  } catch {
    text = null;
  }
  if (text === null) return meta;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return meta;
    const o: Record<string, unknown> = { ...raw };
    if (typeof o.enabled === 'boolean') meta.enabled = o.enabled;
    meta.syncedUser = str(o.syncedUser);
    meta.syncedServerAt = str(o.syncedServerAt);
    if (typeof o.localDirty === 'boolean') meta.localDirty = o.localDirty;
    meta.localUpdatedAt = str(o.localUpdatedAt);
    if (Array.isArray(o.queue)) {
      meta.queue = o.queue
        .map(parseRecord)
        .filter((r): r is RecordInput => r !== null)
        .slice(-ONLINE_CONFIG.queueMax);
    }
  } catch {
    // 壊れていたら初期値
  }
  return meta;
}

/** 書く。書けなくても（容量・プライベートモード）ゲームは続ける */
export function storeMeta(storage: StorageLike | null, meta: OnlineMeta): void {
  try {
    storage?.setItem(ONLINE_CONFIG.storageKey, JSON.stringify(meta));
  } catch {
    // 次の保存で書き直す
  }
}

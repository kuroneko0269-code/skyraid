// サーバーから返った行の形の確認（7-4、DOM・Supabase 非依存）。形が違えば例外（OnlineError: unknown）
import { OnlineError, type RankingRow, type RemoteSave } from './backend';
import type { RecordDetail } from './records';
import type { RemoteSaveInfo } from './sync-rules';

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new OnlineError('unknown', 'bad row');
  return { ...v };
}

function num(v: unknown): number {
  // bigint の列は文字列で返ることがある
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new OnlineError('unknown', 'bad number');
  return n;
}

function text(v: unknown): string {
  if (typeof v !== 'string') throw new OnlineError('unknown', 'bad text');
  return v;
}

function detail(v: unknown): RecordDetail {
  const out: Record<string, string | number | boolean> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') out[k] = x;
  }
  return out;
}

export function parseSaveInfo(v: unknown): RemoteSaveInfo {
  const o = obj(v);
  return { version: num(o.version), updatedAt: text(o.updated_at) };
}

export function parseRemoteSave(v: unknown): RemoteSave {
  const o = obj(v);
  return { ...parseSaveInfo(v), data: o.data };
}

export function parseRankingRows(v: unknown): RankingRow[] {
  if (!Array.isArray(v)) throw new OnlineError('unknown', 'bad rows');
  return v.map((row: unknown) => {
    const o = obj(row);
    return {
      userId: text(o.user_id),
      displayName: typeof o.display_name === 'string' ? o.display_name : null,
      aircraftId: text(o.aircraft_id),
      valueMs: num(o.value_ms),
      detail: detail(o.detail),
      createdAt: text(o.created_at),
      place: num(o.place),
    };
  });
}

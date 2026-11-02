// メンバー承認のアプリ内管理（7-4b、DOM・Supabase 非依存）: owner の判定・参加の申請の状態・一覧の整形。
// SQL は supabase/migrations/skyraid_0002_members.sql（approve_member / revoke_member / list_members / join_requests）
import { compareText } from '../core/format';
import { t } from '../core/i18n';
import { OnlineError } from './backend';
import { formatDateTime } from './format';

export const OWNER_ROLE = 'owner';

/** 参加の申請の状態（join_requests.status） */
export const JOIN_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type JoinStatus = (typeof JOIN_STATUSES)[number];

export function isJoinStatus(v: unknown): v is JoinStatus {
  return typeof v === 'string' && (JOIN_STATUSES as readonly string[]).includes(v);
}

/** app_metadata.roles から、このアプリの役割を取り出す（無ければ null）。roles は管理者だけが書き換えられる（規約 3.3） */
export function roleFromMetadata(appMetadata: unknown, app: string): string | null {
  if (typeof appMetadata !== 'object' || appMetadata === null) return null;
  const roles: unknown = Object.getOwnPropertyDescriptor(appMetadata, 'roles')?.value;
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) return null;
  const role: unknown = Object.getOwnPropertyDescriptor(roles, app)?.value;
  return typeof role === 'string' ? role : null;
}

/** owner か（SQL の skyraid.is_owner() と同じ判定。画面の出し分けだけに使い、権限はサーバーが確かめる） */
export function isOwnerRole(role: string | null): boolean {
  return role === OWNER_ROLE;
}

/** owner の操作 */
export type MemberAction = 'approve' | 'reject' | 'revoke';

/**
 * 操作の後の状態。できない操作は null（承認待ちだけ承認・却下でき、承認済みだけ取り消せる）。
 * 取り消した人は SQL で rejected になり、一覧から消える
 */
export function nextJoinStatus(current: JoinStatus, action: MemberAction): JoinStatus | null {
  if (current === 'pending') {
    if (action === 'approve') return 'approved';
    if (action === 'reject') return 'rejected';
    return null;
  }
  if (current === 'approved' && action === 'revoke') return 'rejected';
  return null;
}

/** list_members() の 1 行 */
export interface MemberRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly status: JoinStatus;
  readonly requestedAt: string | null;
}

/** サーバーの行を確かめる（形が違う行は捨てる） */
export function parseMemberRows(v: unknown): MemberRow[] {
  if (!Array.isArray(v)) throw new OnlineError('unknown', 'bad rows');
  const items: readonly unknown[] = v;
  const out: MemberRow[] = [];
  for (const r of items) {
    if (typeof r !== 'object' || r === null) continue;
    const o: Record<string, unknown> = { ...r };
    if (typeof o.user_id !== 'string' || !isJoinStatus(o.status)) continue;
    out.push({
      userId: o.user_id,
      displayName: typeof o.display_name === 'string' ? o.display_name : null,
      status: o.status,
      requestedAt: typeof o.requested_at === 'string' ? o.requested_at : null,
    });
  }
  return out;
}

/** 操作が成功した後の一覧（読み直さずに画面を更新する）。rejected になった行は消す */
export function applyMemberAction(
  rows: readonly MemberRow[],
  userId: string,
  action: MemberAction,
): MemberRow[] {
  const out: MemberRow[] = [];
  for (const r of rows) {
    if (r.userId !== userId) {
      out.push(r);
      continue;
    }
    const next = nextJoinStatus(r.status, action);
    if (next === null) out.push(r);
    else if (next !== 'rejected') out.push({ ...r, status: next });
  }
  return out;
}

/** 画面の 1 行 */
export interface MemberLine {
  readonly userId: string;
  readonly name: string;
  /** 申請日時（SQL で承認した人は「—」） */
  readonly requested: string;
  /** 自分（取り消しのボタンを出さない） */
  readonly self: boolean;
}

export interface MemberLists {
  /** 承認待ち（申請の古い順） */
  readonly pending: readonly MemberLine[];
  /** 承認済み（自分が先頭、あとは名前順） */
  readonly approved: readonly MemberLine[];
}

function time(iso: string | null): number {
  const t = iso === null ? NaN : Date.parse(iso);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** 一覧を承認待ち・承認済みに分けて並べる */
export function memberLists(rows: readonly MemberRow[], selfId: string | null): MemberLists {
  const line = (r: MemberRow): MemberLine => ({
    userId: r.userId,
    name: r.displayName ?? t('online.unnamed'),
    requested: r.requestedAt === null ? '—' : formatDateTime(r.requestedAt),
    self: r.userId === selfId,
  });
  const pending = rows
    .filter((r) => r.status === 'pending')
    .sort((a, b) => time(a.requestedAt) - time(b.requestedAt) || a.userId.localeCompare(b.userId))
    .map(line);
  const approved = rows
    .filter((r) => r.status === 'approved')
    .map(line)
    .sort(
      (a, b) =>
        Number(b.self) - Number(a.self) ||
        compareText(a.name, b.name) ||
        a.userId.localeCompare(b.userId),
    );
  return { pending, approved };
}

// 画面に出す一言（7-4、DOM・Supabase 非依存）: 失敗の種類・同期の結果。文面は文言の表（online.* / sync.*。8-4）
import { t } from '../core/i18n';
import { errorKind, type OnlineErrorKind } from './backend';
import type { SyncEvent } from './sync';

/** 失敗の種類（文言は online.error.<種類> と online.reason.<種類>）。Record にして種類の漏れを型で防ぐ */
const ERROR_KINDS: Readonly<Record<OnlineErrorKind, true>> = {
  network: true,
  auth: true,
  // 承認待ちの案内（online-settings の pendingText）とは別の文言にする: denied は RLS・403 などの拒否（7-4d）
  denied: true,
  signup: true,
  invalid: true,
  rate: true,
  conflict: true,
  code: true,
  unknown: true,
};

/** 参加の申請（join_requests への insert）に失敗したときの一言（7-4d）。承認待ちの案内と並べて出す */
export function joinFailureText(kind: OnlineErrorKind, detail: string): string {
  const d = detail.trim().slice(0, 120);
  // 失敗の種類の短い名前（申請の失敗の「理由」に出す）
  const name = t(`online.reason.${kind}`);
  const reason = d ? t('online.reasonDetail', { reason: name, detail: d }) : name;
  return t('online.joinFailure', { reason });
}

/** 失敗（例外か種類）→ 一言 */
export function errorMessage(e: unknown): string {
  return t(`online.error.${isErrorKind(e) ? e : errorKind(e)}`);
}

function isErrorKind(v: unknown): v is OnlineErrorKind {
  return typeof v === 'string' && Object.hasOwn(ERROR_KINDS, v);
}

/** 同期の結果 → 一言（空は出さない） */
export const SYNC_TEXT: Readonly<Record<SyncEvent, string>> = {
  pushed: '',
  upToDate: '',
  get pulled() {
    return t('sync.event.pulled');
  },
  get tooNew() {
    return t('sync.event.tooNew');
  },
  get tooLarge() {
    return t('sync.event.tooLarge');
  },
  get failed() {
    return t('sync.event.failed');
  },
  get later() {
    return t('sync.event.later');
  },
};

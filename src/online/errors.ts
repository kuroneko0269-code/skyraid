// Supabase（PostgREST・Auth）のエラー → 失敗の種類（7-4 / 7-4d、DOM・Supabase 非依存）
import type { OnlineErrorKind } from './backend';

export interface ErrorLike {
  readonly code?: string;
  readonly message?: string;
  readonly hint?: string;
  readonly status?: number;
  readonly name?: string;
}

/** Auth が新規登録を断ったときのエラーコード（どれも HTTP 422） */
const SIGNUP_CODES: ReadonlySet<string> = new Set([
  'signup_disabled',
  'otp_disabled',
  'email_provider_disabled',
  'email_address_not_authorized',
  'email_address_invalid',
]);

/**
 * /auth/v1/otp（コードを送る）のエラー → 失敗の種類（7-4d）。422 は新規登録が無効などで「このメールは登録できない」。
 * 古い Auth はコードを付けずに 422 だけを返すので、状態の数字でも判定する（429 などはふつうの分類のまま）
 */
export function classifySendCodeError(e: ErrorLike): OnlineErrorKind {
  const kind = classifyError(e);
  if (kind === 'rate') return kind;
  return e.status === 422 ? 'signup' : kind;
}

/** PostgREST・Auth のエラー → 失敗の種類 */
export function classifyError(e: ErrorLike): OnlineErrorKind {
  const code = e.code ?? '';
  const msg = e.message ?? '';
  if (e.hint === 'rate_limit' || e.status === 429 || code === 'over_email_send_rate_limit')
    return 'rate';
  if (code === '23514' || code === '22P02' || code === '23502') return 'invalid';
  if (code === '23505') return 'conflict';
  // 新規登録が無効（Allow new users to sign up が OFF）。承認待ちや RLS の拒否とは別に扱う（7-4d）
  if (SIGNUP_CODES.has(code)) return 'signup';
  if (code === '42501') return 'denied';
  if (code === 'otp_expired' || code === 'validation_failed') return 'code';
  if (code === 'PGRST301' || code === 'PGRST303' || e.status === 401) return 'auth';
  // コードの無い 403（コードの不一致は 403 + otp_expired なので、その判定の後）
  if (e.status === 403) return 'denied';
  if (e.name === 'AuthRetryableFetchError' || /fetch|network/i.test(msg) || code === '')
    return 'network';
  return 'unknown';
}

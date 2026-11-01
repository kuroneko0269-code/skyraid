// メールのコードでのログイン（7-4c、DOM・Supabase 非依存）: 入力の整え・桁数の検証・失敗の種類と画面に出す一言。
// Supabase のメール OTP は設定で桁数が変わる（今のプロジェクトは 8 桁）ので 4〜10 桁を受け付ける
import { ONLINE_CONFIG } from '../data/online';
import { errorKind } from './backend';

const { minLength, maxLength, expirySec } = ONLINE_CONFIG.otp;

/** 入力欄の値を数字だけにする（全角数字は半角に。数字以外は落とし、最大桁で切る） */
export function sanitizeCodeInput(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, maxLength);
}

/** 送る前の検証。空・桁数不足なら送らない */
export type CodeCheck =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: 'empty' | 'short' };

export function checkCode(input: string): CodeCheck {
  const code = sanitizeCodeInput(input);
  if (code.length === 0) return { ok: false, reason: 'empty' };
  if (code.length < minLength) return { ok: false, reason: 'short' };
  return { ok: true, code };
}

/** ログインの失敗の種類 */
export type CodeFailure =
  'empty' | 'short' | 'mismatch' | 'expired' | 'attempts' | 'network' | 'unknown';

export const CODE_FAILURE_TEXT: Readonly<Record<CodeFailure, string>> = {
  empty: 'コードを入力してください',
  short: `コードの桁が足りません（${String(minLength)}〜${String(maxLength)} 桁）`,
  mismatch: 'コードが違います。メールのコードを確かめてください',
  expired: 'コードの期限が切れました。コードを送り直してください',
  attempts: '試した回数が多すぎます。少し待ってからもう一度',
  network: 'サーバーにつながりません。通信を確かめてください',
  unknown: 'ログインできませんでした。少し待ってからもう一度',
};

/**
 * verifyCode の失敗 → 種類。Supabase は不一致も期限切れも同じ otp_expired で返すので、
 * コードを送ってからの経過（elapsedMs）が期限を過ぎていれば期限切れ、それ以外は不一致とする
 */
export function codeFailure(e: unknown, elapsedMs: number): CodeFailure {
  switch (errorKind(e)) {
    case 'code':
    case 'auth':
    case 'invalid':
      return elapsedMs >= expirySec * 1000 ? 'expired' : 'mismatch';
    case 'rate':
      return 'attempts';
    case 'network':
      return 'network';
    default:
      return 'unknown';
  }
}

/** 入力欄の案内（桁数は書かない。プロジェクトの設定で変わるため） */
export const CODE_PLACEHOLDER = 'メールに届いたコードを入力';

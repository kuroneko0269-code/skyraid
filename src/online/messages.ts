// 画面に出す一言（7-4、DOM・Supabase 非依存）: 失敗の種類・同期の結果
import { errorKind, type OnlineErrorKind } from './backend';
import type { SyncEvent } from './sync';

const ERROR_TEXT: Readonly<Record<OnlineErrorKind, string>> = {
  network: 'サーバーにつながりません。通信を確かめてください（ゲームはこのまま遊べます）',
  auth: 'ログインが切れました。もう一度ログインしてください',
  // 承認待ちの案内（online-settings の pendingText）とは別の文言にする: こちらは RLS・403 などの拒否（7-4d）
  denied:
    'サーバーに操作を拒否されました（権限エラー）。ログインし直しても続くときは管理者に連絡してください',
  signup: 'このメールは登録できません。管理者に連絡してください',
  invalid: '送った内容がサーバーに受け付けられませんでした',
  rate: '短い間に送りすぎました。少し待ってからもう一度',
  conflict: 'サーバーのデータが先に変わっていました',
  code: 'コードが違うか、期限が切れています。もう一度コードを送ってください',
  unknown: 'うまくいきませんでした。少し待ってからもう一度',
};

/** 失敗の種類の短い名前（申請の失敗の「理由」に出す。7-4d） */
const REASON_TEXT: Readonly<Record<OnlineErrorKind, string>> = {
  network: '通信エラー',
  auth: 'ログインが確立していない',
  denied: 'サーバーが拒否（権限・RLS）',
  signup: '登録できないメール',
  invalid: '内容が受け付けられない',
  rate: '送りすぎ',
  conflict: '競合',
  code: 'コードの誤り',
  unknown: '不明なエラー',
};

/** 参加の申請（join_requests への insert）に失敗したときの一言（7-4d）。承認待ちの案内と並べて出す */
export function joinFailureText(kind: OnlineErrorKind, detail: string): string {
  const d = detail.trim().slice(0, 120);
  return `申請の送信に失敗しました（理由: ${REASON_TEXT[kind]}${d ? ` / ${d}` : ''}）。「承認を再確認」で送り直します`;
}

/** 失敗（例外か種類）→ 一言 */
export function errorMessage(e: unknown): string {
  return ERROR_TEXT[isErrorKind(e) ? e : errorKind(e)];
}

function isErrorKind(v: unknown): v is OnlineErrorKind {
  return typeof v === 'string' && Object.hasOwn(ERROR_TEXT, v);
}

/** 同期の結果 → 一言（空は出さない） */
export const SYNC_TEXT: Readonly<Record<SyncEvent, string>> = {
  pushed: '',
  upToDate: '',
  pulled: 'サーバーのセーブを読み込みました',
  tooNew: 'サーバーのセーブが新しい版です。ページを読み込み直してアプリを更新してください',
  tooLarge: 'セーブが大きすぎてバックアップできません（256KB まで）',
  failed: 'セーブを同期できませんでした。次の保存か起動のときにもう一度試します',
  later: 'セーブの同期を保留しました。次の起動のときにもう一度聞きます',
};

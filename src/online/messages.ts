// 画面に出す一言（7-4、DOM・Supabase 非依存）: 失敗の種類・同期の結果
import { errorKind, type OnlineErrorKind } from './backend';
import type { SyncEvent } from './sync';

const ERROR_TEXT: Readonly<Record<OnlineErrorKind, string>> = {
  network: 'サーバーにつながりません。通信を確かめてください（ゲームはこのまま遊べます）',
  auth: 'ログインが切れました。もう一度ログインしてください',
  denied: '権限がありません。管理者に承認を依頼してください',
  invalid: '送った内容がサーバーに受け付けられませんでした',
  rate: '短い間に送りすぎました。少し待ってからもう一度',
  conflict: 'サーバーのデータが先に変わっていました',
  code: 'コードが違うか、期限が切れています。もう一度コードを送ってください',
  unknown: 'うまくいきませんでした。少し待ってからもう一度',
};

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

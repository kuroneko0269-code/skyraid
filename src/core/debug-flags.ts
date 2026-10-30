export interface DebugFlags {
  /** デバッグ表示（fps 等）を初期表示するか。?debug（値は問わない）で true */
  overlay: boolean;
  /** 押したアクション名をコンソールに出すか。?debug=input で true */
  logInput: boolean;
}

/** URL のクエリ文字列からデバッグ用フラグを読む */
export function parseDebugFlags(search: string): DebugFlags {
  const params = new URLSearchParams(search);
  return {
    overlay: params.has('debug'),
    logInput: params.getAll('debug').includes('input'),
  };
}

/** ?skipTitle（開発用）: タイトルとモード選択を飛ばして、起動後すぐフリーフライトに入る */
export function parseSkipTitle(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('skipTitle') || params.has('skiptitle');
}

/** ?unlockAll（開発用）: キャンペーンのミッションをすべて解放する（確認用。2-5） */
export function parseUnlockAll(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('unlockAll') || params.has('unlockall');
}

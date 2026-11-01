// 環境変数（規約 5 章: VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）の読み取り（7-4、DOM・Supabase 非依存）。
// どちらかが無い・URL が https でないときはオフライン: オンライン連携の部分を読み込まず、UI も出さない
export interface OnlineEnv {
  /** プロジェクトの URL（末尾の / を除く） */
  readonly url: string;
  /** その URL のオリジン（CSP の connect-src に足す） */
  readonly origin: string;
  /** anon key / publishable key（公開前提の値。権限は RLS で絞る） */
  readonly anonKey: string;
}

export interface RawOnlineEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

/** service_role key・secret key はクライアントに置かない（規約 5 章）。誤って入れたらオフラインにする */
export function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  // 旧形式の JWT の key: 中の role が service_role なら拒否
  const part = key.split('.')[1];
  if (!part) return false;
  try {
    const json: unknown = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return (
      typeof json === 'object' && json !== null && 'role' in json && json.role === 'service_role'
    );
  } catch {
    return false;
  }
}

/** 環境変数を読む。オフラインなら null */
export function readOnlineEnv(raw: RawOnlineEnv): OnlineEnv | null {
  const url = raw.VITE_SUPABASE_URL?.trim() ?? '';
  const anonKey = raw.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (url === '' || anonKey === '') return null;
  if (looksLikeSecretKey(anonKey)) return null;
  const origin = supabaseOrigin(url);
  if (origin === null) return null;
  return { url: url.replace(/\/+$/, ''), origin, anonKey };
}

/** https の URL のオリジン（パス・ワイルドカードは不可）。読めなければ null */
export function supabaseOrigin(url: string): string | null {
  if (url.includes('*')) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
    return u.origin;
  } catch {
    return null;
  }
}

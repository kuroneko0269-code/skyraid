// CSP（7-4、DOM 非依存。ビルド時に vite.config.ts から使う）: _headers の connect-src に Supabase のオリジンだけを足す。
// ワイルドカード（*.supabase.co）にはしない（規約 5 章）。オリジンが無ければ元のまま
import { supabaseOrigin } from './env';

/** _headers の本文の Content-Security-Policy の connect-src に origin を足す。足せなければ（行が無い等）元のまま */
export function addConnectSrc(headers: string, url: string | undefined): string {
  const origin = url ? supabaseOrigin(url.trim()) : null;
  if (origin === null) return headers;
  return headers.replace(
    /^(\s*Content-Security-Policy:.*?connect-src)([^;]*)(;|$)/m,
    (_all, head: string, sources: string, tail: string) => {
      const list = sources.trim().split(/\s+/).filter(Boolean);
      if (!list.includes(origin)) list.push(origin);
      return `${head} ${list.join(' ')}${tail}`;
    },
  );
}

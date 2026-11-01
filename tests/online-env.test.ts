// 7-4: オフラインの判定（環境変数が無い・不正なら連携の部分を読み込まない）と CSP の connect-src
import { describe, expect, it } from 'vitest';
import headers from '../public/_headers?raw';
import { addConnectSrc } from '../src/online/csp';
import { looksLikeSecretKey, readOnlineEnv } from '../src/online/env';

const URL_OK = 'https://abcdefgh.supabase.co';

function jwt(payload: object): string {
  const b64 = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

describe('オフラインの判定', () => {
  it('どちらかの環境変数が無ければオフライン（null）', () => {
    expect(readOnlineEnv({})).toBeNull();
    expect(readOnlineEnv({ VITE_SUPABASE_URL: URL_OK })).toBeNull();
    expect(readOnlineEnv({ VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' })).toBeNull();
    expect(readOnlineEnv({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: ' ' })).toBeNull();
  });

  it('https でない・ワイルドカード・読めない URL はオフライン', () => {
    const key = 'sb_publishable_x';
    expect(
      readOnlineEnv({ VITE_SUPABASE_URL: 'http://a.supabase.co', VITE_SUPABASE_ANON_KEY: key }),
    ).toBeNull();
    expect(
      readOnlineEnv({ VITE_SUPABASE_URL: 'https://*.supabase.co', VITE_SUPABASE_ANON_KEY: key }),
    ).toBeNull();
    expect(
      readOnlineEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: key }),
    ).toBeNull();
  });

  it('service_role key・secret key を入れてしまったらオフライン（クライアントに置かない）', () => {
    expect(looksLikeSecretKey('sb_secret_abc')).toBe(true);
    expect(looksLikeSecretKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(looksLikeSecretKey(jwt({ role: 'anon' }))).toBe(false);
    expect(looksLikeSecretKey('sb_publishable_abc')).toBe(false);
    expect(
      readOnlineEnv({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' }),
    ).toBeNull();
  });

  it('正しければ URL・オリジン・key を返す（末尾の / は落とす）', () => {
    const env = readOnlineEnv({
      VITE_SUPABASE_URL: `${URL_OK}/`,
      VITE_SUPABASE_ANON_KEY: jwt({ role: 'anon' }),
    });
    expect(env?.url).toBe(URL_OK);
    expect(env?.origin).toBe(URL_OK);
  });
});

describe('CSP の connect-src（ビルド時の _headers）', () => {
  it('Supabase のオリジンだけを足す（ワイルドカードにしない）', () => {
    const out = addConnectSrc(headers, `${URL_OK}/rest/v1`);
    const csp = out.split('\n').find((l) => l.includes('Content-Security-Policy')) ?? '';
    expect(csp).toMatch(
      /connect-src 'self' wss:\/\/0\.peerjs\.com https:\/\/abcdefgh\.supabase\.co;/,
    );
    expect(csp).not.toContain('*');
    // ほかの行・ディレクティブは変えない
    expect(out.replace(` ${URL_OK}`, '')).toBe(headers);
  });

  it('環境変数が無い・不正なら元のまま。2 回足しても 1 つ', () => {
    expect(addConnectSrc(headers, undefined)).toBe(headers);
    expect(addConnectSrc(headers, '')).toBe(headers);
    expect(addConnectSrc(headers, 'https://*.supabase.co')).toBe(headers);
    const once = addConnectSrc(headers, URL_OK);
    expect(addConnectSrc(once, URL_OK)).toBe(once);
  });

  it('リポジトリの public/_headers には Supabase を書かない（ビルドで足す）', () => {
    expect(headers).not.toContain('supabase');
  });
});

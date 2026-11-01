// 7-4d: 承認前のユーザーの参加の申請（join_requests）が入らなかった不具合の修正の確認。
// - コードを送る（/auth/v1/otp）の 422（新規登録が無効）を「権限がありません」ではなく「このメールは登録できません」にする
// - 申請の失敗を握りつぶさず、console と画面（status.joinError）に種類を出し、次の機会に送り直す
// - 「権限エラー（RLS・403）」と「承認待ち」を文言で区別する
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineError } from '../src/online/backend';
import { classifyError, classifySendCodeError } from '../src/online/errors';
import { errorMessage, joinFailureText } from '../src/online/messages';
import { OnlineService } from '../src/online/service';
import type { SaveAccess, SyncHooks } from '../src/online/sync';
import { ManualTimers, MemoryStorage, MockBackend, STRANGER, settle } from './online-helpers';

function setup(backend = new MockBackend()) {
  backend.user = STRANGER;
  const save = {
    data: () => ({}),
    version: 8,
    apply: () => true,
    reload: vi.fn<() => void>(),
  } satisfies SaveAccess;
  const hooks = {
    ask: vi.fn(() => Promise.resolve(null)),
    whenSafe: (fn) => {
      fn();
    },
    report: vi.fn<SyncHooks['report']>(),
  } satisfies SyncHooks;
  const service = new OnlineService(
    backend,
    new MemoryStorage(),
    save,
    hooks,
    () => 'ACE',
    new ManualTimers(),
  );
  return { backend, service };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('コードを送るときの 422（新規登録が無効）', () => {
  it('signup_disabled・otp_disabled・コードの無い 422 は signup（権限エラーにしない）', () => {
    expect(classifySendCodeError({ status: 422, code: 'signup_disabled', message: 'x' })).toBe(
      'signup',
    );
    expect(classifySendCodeError({ status: 422, code: 'otp_disabled', message: 'x' })).toBe(
      'signup',
    );
    expect(classifySendCodeError({ status: 422, message: 'Signups not allowed for otp' })).toBe(
      'signup',
    );
    expect(classifyError({ code: 'signup_disabled' })).toBe('signup');
  });

  it('送りすぎ（429・over_email_send_rate_limit）は rate のまま。通信エラーは network のまま', () => {
    expect(classifySendCodeError({ status: 429, message: 'x' })).toBe('rate');
    expect(classifySendCodeError({ status: 422, code: 'over_email_send_rate_limit' })).toBe('rate');
    expect(
      classifySendCodeError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }),
    ).toBe('network');
  });

  it('文言は「このメールは登録できません」。申請は送らない（ログインしていないので申請の呼び出しも無い）', async () => {
    const t = setup();
    t.backend.user = null;
    await t.service.start();
    expect(errorMessage(new OnlineError('signup', 'x'))).toBe(
      'このメールは登録できません。管理者に連絡してください',
    );
    expect(t.backend.calls.requestJoin).toBe(0);
  });
});

describe('権限エラーと承認待ちの区別', () => {
  it('RLS の拒否（42501）とコードの無い 403 は denied。コードの不一致（403 + otp_expired）は code', () => {
    expect(classifyError({ code: '42501', status: 403 })).toBe('denied');
    expect(classifyError({ status: 403, message: 'Forbidden' })).toBe('denied');
    expect(classifyError({ code: 'otp_expired', status: 403 })).toBe('code');
  });

  it('denied の文言は承認の依頼ではなく権限エラー（承認待ちの案内と混ざらない）', () => {
    const denied = errorMessage('denied');
    expect(denied).toContain('権限エラー');
    expect(denied).not.toContain('承認');
    expect(errorMessage('signup')).not.toBe(denied);
  });
});

describe('参加の申請の失敗を握りつぶさない', () => {
  it('失敗したら console に出し、status.joinError に種類が載る。状態は承認待ちのまま', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const backend = new MockBackend();
    const t = setup(backend);
    backend.joinFailures = ['denied', 'denied'];
    await t.service.start();
    await settle();
    expect(t.service.status.state).toBe('pending');
    expect(t.service.status.joinError?.kind).toBe('denied');
    expect(t.service.status.join).toBeNull();
    expect(err).toHaveBeenCalled();
  });

  it('「承認を再確認」（トークンの取り直し）で送り直し、成功したら joinError が消える', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const backend = new MockBackend();
    const t = setup(backend);
    backend.joinFailures = ['network', 'network'];
    await t.service.start();
    await settle();
    expect(t.service.status.joinError?.kind).toBe('network');
    expect(backend.joins.has(STRANGER.id)).toBe(false);
    backend.nextRefresh = STRANGER;
    await t.service.recheck();
    await settle();
    expect(t.service.status.joinError).toBeNull();
    expect(t.service.status.join).toBe('pending');
    expect(backend.joins.get(STRANGER.id)).toEqual({ name: 'ACE', status: 'pending' });
  });

  it('画面の一言は「申請の送信に失敗」+ 理由（種類とサーバーの一言）', () => {
    const text = joinFailureText('denied', 'new row violates row-level security policy');
    expect(text).toContain('申請の送信に失敗しました');
    expect(text).toContain('サーバーが拒否');
    expect(text).toContain('row-level security');
    expect(joinFailureText('invalid', '')).toContain('内容が受け付けられない）');
  });
});

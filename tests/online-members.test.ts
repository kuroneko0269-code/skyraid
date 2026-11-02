// 7-4b: メンバー承認のアプリ内管理（owner の判定・参加の申請の状態遷移・一覧の整形・承認待ちの自動の再確認）
import { describe, expect, it, vi } from 'vitest';
import { ONLINE_CONFIG } from '../src/data/online';
import { MemberAdmin } from '../src/online/member-admin';
import {
  applyMemberAction,
  isOwnerRole,
  memberLists,
  nextJoinStatus,
  parseMemberRows,
  roleFromMetadata,
  type MemberRow,
} from '../src/online/members';
import { OnlineService } from '../src/online/service';
import type { SaveAccess, SyncHooks } from '../src/online/sync';
import {
  MEMBER,
  ManualTimers,
  MemoryStorage,
  MockBackend,
  OWNER,
  STRANGER,
  settle,
} from './online-helpers';

function setup(user: typeof MEMBER | null, backend = new MockBackend()) {
  backend.user = user;
  const timers = new ManualTimers();
  const save = {
    data: () => ({ credits: 1 }),
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
    () => '  ACE  ',
    timers,
  );
  return { backend, timers, service };
}

describe('owner の判定（app_metadata.roles.skyraid）', () => {
  it('roles.skyraid が owner のときだけ owner。他アプリの owner・user_metadata の形は数えない', () => {
    expect(roleFromMetadata({ roles: { skyraid: 'owner' } }, 'skyraid')).toBe('owner');
    expect(roleFromMetadata({ roles: { other: 'owner' } }, 'skyraid')).toBeNull();
    expect(roleFromMetadata({ roles: ['owner'] }, 'skyraid')).toBeNull();
    expect(roleFromMetadata({ roles: { skyraid: 1 } }, 'skyraid')).toBeNull();
    expect(roleFromMetadata({ role: 'owner' }, 'skyraid')).toBeNull();
    expect(roleFromMetadata(null, 'skyraid')).toBeNull();
    expect(roleFromMetadata('owner', 'skyraid')).toBeNull();
    expect(isOwnerRole('owner')).toBe(true);
    expect(isOwnerRole('member')).toBe(false);
    expect(isOwnerRole(null)).toBe(false);
  });

  it('サービスの状態に owner が載る（未ログイン・メンバーは false）', async () => {
    const owner = setup(OWNER);
    await owner.service.start();
    expect(owner.service.status.owner).toBe(true);
    const member = setup(MEMBER);
    await member.service.start();
    expect(member.service.status.owner).toBe(false);
    const out = setup(null);
    await out.service.start();
    expect(out.service.status.owner).toBe(false);
  });
});

describe('参加の申請の状態遷移', () => {
  it('承認待ちだけ承認・却下でき、承認済みだけ取り消せる。却下・取り消しは rejected', () => {
    expect(nextJoinStatus('pending', 'approve')).toBe('approved');
    expect(nextJoinStatus('pending', 'reject')).toBe('rejected');
    expect(nextJoinStatus('pending', 'revoke')).toBeNull();
    expect(nextJoinStatus('approved', 'revoke')).toBe('rejected');
    expect(nextJoinStatus('approved', 'approve')).toBeNull();
    expect(nextJoinStatus('approved', 'reject')).toBeNull();
    expect(nextJoinStatus('rejected', 'approve')).toBeNull();
    expect(nextJoinStatus('rejected', 'revoke')).toBeNull();
  });

  it('ログインして承認待ちなら、パイロット名で 1 回だけ申請する（もう行があれば何もしない）', async () => {
    const t = setup(STRANGER);
    await t.service.start();
    await settle();
    expect(t.backend.calls.requestJoin).toBe(1);
    expect(t.backend.joins.get(STRANGER.id)).toEqual({ name: 'ACE', status: 'pending' });
    expect(t.service.status.state).toBe('pending');
    expect(t.service.status.join).toBe('pending');
    // トークンの更新などで同じユーザーがまた来ても送り直さない
    t.backend.emitAuth(STRANGER);
    await settle();
    expect(t.backend.calls.requestJoin).toBe(1);
  });

  it('連携中（承認済み）の人は申請しない', async () => {
    const t = setup(MEMBER);
    await t.service.start();
    await settle();
    expect(t.backend.calls.requestJoin).toBe(0);
    expect(t.service.status.join).toBeNull();
  });

  it('却下された人は rejected が見える（申請で上書きしない）', async () => {
    const backend = new MockBackend();
    backend.joins.set(STRANGER.id, { name: 'OLD', status: 'rejected' });
    const t = setup(STRANGER, backend);
    await t.service.start();
    await settle();
    expect(t.service.status.join).toBe('rejected');
    expect(backend.joins.get(STRANGER.id)?.name).toBe('OLD');
  });
});

describe('承認された側: 起動時と 5 分ごとに自動で再確認', () => {
  it('起動時に承認待ちなら、すぐトークンを取り直す。承認されていれば連携中になって同期を始める', async () => {
    const backend = new MockBackend();
    backend.nextRefresh = { ...STRANGER, apps: ['other', 'skyraid'] };
    const t = setup(STRANGER, backend);
    await t.service.start();
    await settle();
    expect(backend.calls.refresh).toBe(1);
    expect(t.service.status.state).toBe('linked');
    expect(backend.calls.insertSave).toBe(1);
    expect(t.service.watchingPending).toBe(false);
  });

  it('承認待ちの間は 5 分ごとに取り直し、承認されたら止める', async () => {
    const t = setup(STRANGER);
    await t.service.start();
    await settle();
    expect(t.backend.calls.refresh).toBe(1);
    expect(t.service.watchingPending).toBe(true);
    t.timers.advance(ONLINE_CONFIG.pendingRecheckMs - 1);
    await settle();
    expect(t.backend.calls.refresh).toBe(1);
    t.timers.advance(1);
    await settle();
    expect(t.backend.calls.refresh).toBe(2);
    expect(t.service.status.state).toBe('pending');
    // 管理者が承認した
    t.backend.nextRefresh = { ...STRANGER, apps: ['skyraid'] };
    t.timers.advance(ONLINE_CONFIG.pendingRecheckMs);
    await settle();
    expect(t.backend.calls.refresh).toBe(3);
    expect(t.service.status.state).toBe('linked');
    expect(t.service.watchingPending).toBe(false);
    t.timers.advance(ONLINE_CONFIG.pendingRecheckMs * 3);
    await settle();
    expect(t.backend.calls.refresh).toBe(3);
  });

  it('自動の再確認で通信に失敗してもエラーにしない（次の回にまた試す）。ログインが切れたら未連携', async () => {
    const t = setup(STRANGER);
    t.backend.refreshFailure = 'network';
    await t.service.start();
    await settle();
    expect(t.service.status.state).toBe('pending');
    expect(t.service.watchingPending).toBe(true);
    t.backend.refreshFailure = 'auth';
    t.timers.advance(ONLINE_CONFIG.pendingRecheckMs);
    await settle();
    expect(t.service.status.state).toBe('signedOut');
    expect(t.service.watchingPending).toBe(false);
  });

  it('手動の「承認を再確認」の失敗はエラーとして出す', async () => {
    const t = setup(STRANGER);
    await t.service.start();
    t.backend.refreshFailure = 'network';
    await t.service.recheck();
    expect(t.service.status.state).toBe('error');
  });

  it('未ログイン・連携中では予約しない', async () => {
    const out = setup(null);
    await out.service.start();
    expect(out.service.watchingPending).toBe(false);
    expect(out.backend.calls.refresh).toBe(0);
    const member = setup(MEMBER);
    await member.service.start();
    expect(member.service.watchingPending).toBe(false);
    expect(member.backend.calls.refresh).toBe(0);
  });
});

const ROWS: MemberRow[] = [
  { userId: 'u0', displayName: 'BOSS', status: 'approved', requestedAt: null },
  { userId: 'u5', displayName: 'echo', status: 'approved', requestedAt: '2026-10-01T00:00:00Z' },
  { userId: 'u3', displayName: 'Charlie', status: 'pending', requestedAt: '2026-11-01T03:00:00Z' },
  { userId: 'u4', displayName: null, status: 'pending', requestedAt: '2026-11-01T01:00:00Z' },
  { userId: 'u6', displayName: 'ALPHA', status: 'approved', requestedAt: null },
];

describe('一覧の整形', () => {
  it('サーバーの行を確かめる（形の違う行は捨てる）', () => {
    const rows = parseMemberRows([
      { user_id: 'a', display_name: 'A', status: 'pending', requested_at: '2026-11-01T00:00:00Z' },
      { user_id: 'b', display_name: null, status: 'approved', requested_at: null },
      { user_id: 'c', status: 'unknown' },
      { display_name: 'x', status: 'pending' },
      null,
    ]);
    expect(rows).toEqual([
      { userId: 'a', displayName: 'A', status: 'pending', requestedAt: '2026-11-01T00:00:00Z' },
      { userId: 'b', displayName: null, status: 'approved', requestedAt: null },
    ]);
    expect(() => parseMemberRows({})).toThrow();
  });

  it('承認待ちは申請の古い順、承認済みは自分が先頭で名前順。名前なし・申請日時なしの表示', () => {
    const lists = memberLists(ROWS, 'u0');
    expect(lists.pending.map((l) => l.userId)).toEqual(['u4', 'u3']);
    expect(lists.pending[0]?.name).toBe('（名前なし）');
    expect(lists.pending[1]?.requested).toMatch(/^2026\/11\/01 \d\d:00$/);
    expect(lists.approved.map((l) => l.userId)).toEqual(['u0', 'u6', 'u5']);
    expect(lists.approved[0]).toMatchObject({ self: true, requested: '—' });
    expect(lists.approved.filter((l) => l.self)).toHaveLength(1);
  });

  it('操作の後の一覧: 承認で承認済みへ、却下・取り消しで消える。できない操作は変えない', () => {
    const approved = applyMemberAction(ROWS, 'u3', 'approve');
    expect(memberLists(approved, 'u0').approved.map((l) => l.userId)).toContain('u3');
    expect(applyMemberAction(ROWS, 'u4', 'reject').some((r) => r.userId === 'u4')).toBe(false);
    expect(applyMemberAction(ROWS, 'u5', 'revoke').some((r) => r.userId === 'u5')).toBe(false);
    expect(applyMemberAction(ROWS, 'u5', 'approve')).toEqual(ROWS);
  });
});

describe('メンバー管理（MemberAdmin）', () => {
  it('owner は一覧を読み、承認・却下・取り消しができる。できない操作は送らない', async () => {
    const backend = new MockBackend();
    backend.user = OWNER;
    backend.memberRows = ROWS;
    const admin = new MemberAdmin(backend, () => true);
    await admin.load();
    expect(admin.rows).toHaveLength(5);
    expect(await admin.act('u3', 'approve')).toBe(true);
    expect(await admin.act('u4', 'reject')).toBe(true);
    expect(await admin.act('u5', 'revoke')).toBe(true);
    expect(await admin.act('u3', 'approve')).toBe(false);
    expect(await admin.act('zz', 'approve')).toBe(false);
    expect(backend.memberCalls).toEqual(['approve:u3', 'reject:u4', 'revoke:u5']);
    const lists = memberLists(admin.rows, 'u0');
    expect(lists.pending).toHaveLength(0);
    expect(lists.approved.map((l) => l.userId)).toEqual(['u0', 'u6', 'u3']);
  });

  it('owner でなければ呼ばない（サーバーも拒否する）', async () => {
    const backend = new MockBackend();
    backend.user = MEMBER;
    backend.memberRows = ROWS;
    await expect(new MemberAdmin(backend, () => false).load()).rejects.toThrow();
    // 画面の判定をすり抜けても、サーバー（モックでは role）が拒否する
    await expect(new MemberAdmin(backend, () => true).load()).rejects.toMatchObject({
      kind: 'denied',
    });
  });
});

describe('8-6: パイロット名を変えたらメンバー管理の自分の名前も変わる', () => {
  it('読んだ後の一覧の自分の行だけ、読み直さずに新しい名前にする', async () => {
    const backend = new MockBackend();
    backend.user = OWNER;
    backend.memberRows = ROWS;
    const admin = new MemberAdmin(backend, () => true);
    await admin.load();
    const before = admin.rows.find((r) => r.userId === 'u0')?.displayName;
    expect(admin.renameSelf('u0', 'FALCON')).toBe(true);
    expect(admin.rows.find((r) => r.userId === 'u0')?.displayName).toBe('FALCON');
    expect(before).not.toBe('FALCON');
    // 同じ名前・一覧に無い人は何もしない。ほかの行は変えない
    expect(admin.renameSelf('u0', 'FALCON')).toBe(false);
    expect(admin.renameSelf('zz', 'X')).toBe(false);
    expect(admin.rows.filter((r) => r.displayName === 'FALCON')).toHaveLength(1);
    expect(memberLists(admin.rows, 'u0').approved[0]?.name).toBe('FALCON');
  });
});

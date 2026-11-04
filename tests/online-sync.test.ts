// 7-4: セーブの同期。判定の 4 ケース（サーバーに無い / ローカルだけ変更 / サーバーだけ変更 / 両方変更）と、
// デバウンスの送信・他の端末との競合・ダイアログの答え・飛行中の反映待ち。Supabase はモック
import { describe, expect, it, vi } from 'vitest';
import { createMeta } from '../src/online/meta';
import { OnlineService } from '../src/online/service';
import type { ConflictChoice, SaveAccess, SyncHooks } from '../src/online/sync';
import { decideSync, newerSide } from '../src/online/sync-rules';
import {
  MEMBER,
  ManualTimers,
  MemoryStorage,
  MockBackend,
  STRANGER,
  settle,
} from './online-helpers';

describe('同期の判定（decideSync）', () => {
  const synced = { ...createMeta(), syncedUser: 'u1', syncedServerAt: 'T1', localDirty: false };
  const server = { version: 8, updatedAt: 'T1' };

  it('1. サーバーに無い → 送る', () => {
    expect(decideSync(createMeta(), 'u1', null, 8)).toBe('push');
  });

  it('2. サーバーは前回のまま・ローカルだけ変更 → 送る（どちらも変わっていなければ何もしない）', () => {
    expect(decideSync({ ...synced, localDirty: true }, 'u1', server, 8)).toBe('push');
    expect(decideSync(synced, 'u1', server, 8)).toBe('none');
  });

  it('3. サーバーだけ変更（他の端末で遊んだ）→ 受け取る', () => {
    expect(decideSync(synced, 'u1', { version: 8, updatedAt: 'T2' }, 8)).toBe('pull');
  });

  it('4. 両方に変更 → 聞く', () => {
    expect(
      decideSync({ ...synced, localDirty: true }, 'u1', { version: 8, updatedAt: 'T2' }, 8),
    ).toBe('ask');
  });

  it('この端末で初めて・別のユーザー: ローカルは未送信とみなして聞く（勝手に上書きしない）', () => {
    expect(decideSync(createMeta(), 'u1', server, 8)).toBe('ask');
    expect(decideSync(synced, 'u9', server, 8)).toBe('ask');
  });

  it('サーバーの版がこのアプリより新しければ受け取らない', () => {
    expect(decideSync(synced, 'u1', { version: 9, updatedAt: 'T2' }, 8)).toBe('tooNew');
  });

  it('新しい方の印', () => {
    expect(newerSide('2026-11-01T10:00:00Z', '2026-11-01T09:00:00Z')).toBe('local');
    expect(newerSide('2026-11-01T08:00:00Z', '2026-11-01T09:00:00Z')).toBe('server');
    expect(newerSide(null, '2026-11-01T09:00:00Z')).toBe('server');
  });
});

/** オンライン連携のサービスとセーブの代わりを組む */
function setup(
  opts: {
    user?: typeof MEMBER | null;
    choice?: ConflictChoice;
    safe?: boolean;
    /** 前回の起動で端末に残った状態（skyraid.online） */
    storage?: MemoryStorage;
    backend?: MockBackend;
    /** 端末のセーブがこのアプリより新しい版で守っている（9-6a の事前修正） */
    locked?: boolean;
  } = {},
) {
  const backend = opts.backend ?? new MockBackend();
  backend.user = opts.user === undefined ? MEMBER : opts.user;
  const timers = new ManualTimers();
  const storage = opts.storage ?? new MemoryStorage();
  let local: unknown = { credits: 100, pilotName: 'ACE' };
  const save = {
    data: () => local,
    version: 8,
    apply: (d) => {
      local = d;
      // 本物の SaveStore と同じく、置き換えも保存イベントを起こす
      service.localSaved();
      return true;
    },
    reload: vi.fn<() => void>(),
    locked: () => opts.locked === true,
  } satisfies SaveAccess;
  const waiting: (() => void)[] = [];
  const hooks = {
    ask: vi.fn(() => Promise.resolve(opts.choice ?? null)),
    whenSafe: (fn) => {
      if (opts.safe === false) waiting.push(fn);
      else fn();
    },
    report: vi.fn<SyncHooks['report']>(),
  } satisfies SyncHooks;
  const service = new OnlineService(backend, storage, save, hooks, () => 'ACE', timers);
  const edit = (data: unknown): void => {
    local = data;
    service.localSaved();
  };
  return { backend, timers, storage, save, hooks, service, edit, local: () => local, waiting };
}

describe('同期の動き（OnlineService + SaveSync）', () => {
  it('起動のたびに読むのは版と更新日時だけ（変わっていなければ本体は読まない）', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    const again = setup({ storage: t.storage, backend: t.backend });
    await again.service.start();
    await settle();
    expect(again.backend.calls.fetchSaveInfo).toBe(2);
    expect(again.backend.calls.fetchSave).toBe(0);
    expect(again.hooks.report).toHaveBeenCalledWith('upToDate');
  });

  it('ログイン時にサーバーが空なら送る。以後の保存は 3 秒のデバウンスで最後の 1 回だけ送る', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    expect(t.backend.server?.data).toEqual({ credits: 100, pilotName: 'ACE' });
    expect(t.backend.calls.insertSave).toBe(1);

    t.edit({ credits: 200 });
    t.timers.advance(2000);
    t.edit({ credits: 300 });
    t.timers.advance(2999);
    await settle();
    expect(t.backend.calls.updateSave).toBe(0);
    t.timers.advance(1);
    await settle();
    expect(t.backend.calls.updateSave).toBe(1);
    expect(t.backend.server?.data).toEqual({ credits: 300 });
  });

  it('送信に失敗したら次の保存のときにまとめて送る（フレームは止めない: 例外を外へ出さない）', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    t.backend.saveFailure = 'network';
    t.edit({ credits: 1 });
    t.timers.advance(3000);
    await settle();
    expect(t.hooks.report).toHaveBeenCalledWith('failed');
    t.backend.saveFailure = null;
    t.edit({ credits: 2 });
    t.timers.advance(3000);
    await settle();
    expect(t.backend.server?.data).toEqual({ credits: 2 });
  });

  it('起動時にサーバーだけ新しければ受け取って読み込み直す（ローカルの変更として数えない）', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    t.backend.remoteWrite({ credits: 999 });
    // 次の起動（端末の状態とサーバーは同じ）
    const t2 = setup({ storage: t.storage, backend: t.backend });
    await t2.service.start();
    await settle();
    expect(t2.local()).toEqual({ credits: 999 });
    expect(t2.save.reload).toHaveBeenCalledTimes(1);
    expect(t2.hooks.ask).not.toHaveBeenCalled();
    expect(t2.backend.calls.fetchSave).toBe(1);
    // 受け取った直後の保存イベントで送り返さない
    t2.timers.advance(5000);
    await settle();
    expect(t2.backend.calls.updateSave).toBe(0);
  });

  it('他の端末が先に送っていたら（送信が conflict）、両方変更として聞く。「この端末」なら上書き', async () => {
    const t = setup({ choice: 'local' });
    await t.service.start();
    await settle();
    t.backend.remoteWrite({ credits: 5 });
    t.edit({ credits: 7 });
    t.timers.advance(3000);
    await settle();
    expect(t.hooks.ask).toHaveBeenCalledTimes(1);
    expect(t.backend.server?.data).toEqual({ credits: 7 });
    expect(t.save.reload).not.toHaveBeenCalled();
  });

  it('両方変更で「サーバー」を選んだら受け取る。「あとで」なら何も変えない', async () => {
    const a = setup({ choice: 'server' });
    a.backend.remoteWrite({ credits: 5 });
    await a.service.start();
    await settle();
    expect(a.local()).toEqual({ credits: 5 });
    expect(a.save.reload).toHaveBeenCalledTimes(1);

    const b = setup({ choice: null });
    b.backend.remoteWrite({ credits: 5 });
    await b.service.start();
    await settle();
    expect(b.local()).toEqual({ credits: 100, pilotName: 'ACE' });
    expect(b.backend.server?.data).toEqual({ credits: 5 });
    expect(b.hooks.report).toHaveBeenCalledWith('later');
  });

  it('飛行中は反映を待ち、メニューに戻ってから読み込み直す', async () => {
    // 同期の記録がある（前回は T0 で同期。サーバーだけ T9 に変わった）状態から起動する
    const storage = new MemoryStorage();
    storage.setItem(
      'skyraid.online',
      JSON.stringify({
        ...createMeta(),
        syncedUser: 'u1',
        syncedServerAt: 'T0',
        localDirty: false,
      }),
    );
    const backend = new MockBackend();
    backend.server = { version: 8, data: { credits: 1 }, updatedAt: 'T9' };
    const t2 = setup({ safe: false, storage, backend });
    await t2.service.start();
    await settle();
    expect(t2.save.reload).not.toHaveBeenCalled();
    expect(t2.waiting.length).toBe(1);
    t2.waiting[0]?.();
    expect(t2.save.reload).toHaveBeenCalledTimes(1);
  });

  it('承認待ち（apps に skyraid が無い）・未連携・オンライン連携 OFF のときは同期しない', async () => {
    const pending = setup({ user: STRANGER });
    await pending.service.start();
    await settle();
    expect(pending.service.status.state).toBe('pending');
    expect(pending.backend.calls.fetchSaveInfo).toBe(0);

    const out = setup({ user: null });
    await out.service.start();
    out.edit({ credits: 1 });
    out.timers.advance(5000);
    await settle();
    expect(out.service.status.state).toBe('signedOut');
    expect(out.backend.calls.fetchSaveInfo + out.backend.calls.insertSave).toBe(0);

    const off = setup();
    off.service.setEnabled(false);
    await off.service.start();
    off.edit({ credits: 1 });
    off.timers.advance(5000);
    await settle();
    expect(off.backend.calls.fetchSaveInfo + off.backend.calls.insertSave).toBe(0);
    expect(off.service.rankingAvailable).toBe(false);
    // ON に戻すと同期する（ログインは保持していた）
    off.service.setEnabled(true);
    await settle();
    expect(off.backend.server?.data).toEqual({ credits: 1 });
  });

  it('承認後に「再確認」で連携中になり、同期を始める。表示名が無ければパイロット名で作る', async () => {
    const t = setup({ user: STRANGER });
    await t.service.start();
    t.backend.user = { ...STRANGER, apps: ['other', 'skyraid'] };
    await t.service.recheck();
    await settle();
    expect(t.service.status.state).toBe('linked');
    expect(t.backend.server).not.toBeNull();
    expect(t.backend.names.get('u2')).toBe('ACE');
    expect(t.service.profileName).toBe('ACE');
  });

  it('256KB を超えるセーブは送らない', async () => {
    const t = setup();
    t.edit({ big: 'x'.repeat(300 * 1024) });
    await t.service.start();
    await settle();
    expect(t.backend.server).toBeNull();
    expect(t.hooks.report).toHaveBeenCalledWith('tooLarge');
  });

  it('端末のセーブが新しい版（守っている）なら送りも受け取りもしない（9-6a の事前修正）', async () => {
    const backend = new MockBackend();
    backend.server = { version: 8, data: { credits: 5 }, updatedAt: 'T1' };
    const t = setup({ backend, locked: true });
    await t.service.start();
    await settle();
    expect(t.backend.calls.fetchSaveInfo + t.backend.calls.insertSave).toBe(0);
    expect(t.backend.server?.data).toEqual({ credits: 5 });
    expect(t.local()).toEqual({ credits: 100, pilotName: 'ACE' });
    expect(t.hooks.report).toHaveBeenCalledWith('localTooNew');
  });

  it('サーバーのセーブが新しい版なら受け取らず、送って上書きもしない', async () => {
    const backend = new MockBackend();
    backend.server = { version: 99, data: { credits: 5 }, updatedAt: 'T1' };
    const t = setup({ backend });
    await t.service.start();
    await settle();
    expect(t.backend.server?.data).toEqual({ credits: 5 });
    expect(t.backend.calls.insertSave + t.backend.calls.updateSave).toBe(0);
    expect(t.hooks.report).toHaveBeenCalledWith('tooNew');
  });
});

// 7-4b の事前修正: 「セーブデータを削除」のサーバーのバックアップの扱い。
// 残す（既定）: 次の同期ではサーバーを上書きせず、サーバーのセーブを 1 回だけ受け取る / 消す: サーバーの行を消し、次は新しく送る
import { describe, expect, it, vi } from 'vitest';
import { ONLINE_CONFIG } from '../src/data/online';
import { loadMeta } from '../src/online/meta';
import { OnlineService } from '../src/online/service';
import type { SaveAccess, SyncHooks } from '../src/online/sync';
import { decideSync } from '../src/online/sync-rules';
import { MEMBER, ManualTimers, MemoryStorage, MockBackend, settle } from './online-helpers';

const synced = { syncedUser: 'u1', syncedServerAt: 'T1', localDirty: true };

describe('同期の判定（preferServer）', () => {
  it('サーバーにあれば、ローカルの変更があっても受け取る（版が新しすぎれば受け取らない）', () => {
    const at = { version: 8, updatedAt: 'T1' };
    expect(decideSync({ ...synced, preferServer: true }, 'u1', at, 8)).toBe('pull');
    expect(decideSync({ ...synced, preferServer: false }, 'u1', at, 8)).toBe('push');
    expect(decideSync({ ...synced, preferServer: true }, 'u1', { ...at, version: 9 }, 8)).toBe(
      'tooNew',
    );
  });

  it('サーバーに無ければ送る', () => {
    expect(decideSync({ ...synced, preferServer: true }, 'u1', null, 8)).toBe('push');
  });
});

/** 前回の起動で同期済みの端末（サーバーに進んだセーブがある）を作る */
async function syncedDevice() {
  const backend = new MockBackend();
  backend.user = MEMBER;
  const storage = new MemoryStorage();
  const timers = new ManualTimers();
  let local: unknown = { credits: 5000, pilotName: 'ACE' };
  const make = () => {
    const save = {
      data: () => local,
      version: 8,
      apply: (d) => {
        local = d;
        return true;
      },
      reload: vi.fn<() => void>(),
    } satisfies SaveAccess;
    const hooks = {
      ask: vi.fn(() => Promise.resolve(null)),
      whenSafe: (fn) => {
        fn();
      },
      report: vi.fn<SyncHooks['report']>(),
    } satisfies SyncHooks;
    const service = new OnlineService(backend, storage, save, hooks, () => 'ACE', timers);
    return { service, save, hooks };
  };
  const first = make();
  await first.service.start();
  await settle();
  expect(backend.server?.data).toEqual({ credits: 5000, pilotName: 'ACE' });
  return {
    backend,
    storage,
    timers,
    first,
    make,
    /** ローカルを初期化する（SaveStore.clear）。ページを読み込み直したことにして、新しいサービスを返す */
    clearLocal: () => {
      local = { credits: 0, pilotName: null };
    },
    local: () => local,
  };
}

describe('「セーブデータを削除」でサーバーのバックアップを残す（既定）', () => {
  it('読み込み直した後の同期でサーバーを上書きせず、サーバーのセーブを受け取る（1 回だけ）', async () => {
    const d = await syncedDevice();
    d.first.service.sync.preferServerOnce();
    expect(loadMeta(d.storage).preferServer).toBe(true);
    d.clearLocal();
    // 読み込み直し
    const next = d.make();
    // 初期化したセーブの保存（パイロット名の入力など）が先に来ても送らない
    next.service.localSaved();
    d.timers.advance(ONLINE_CONFIG.pushDebounceMs);
    await next.service.start();
    await settle();
    expect(d.backend.calls.updateSave + d.backend.calls.insertSave).toBe(1); // 最初の端末の 1 回だけ
    expect(d.local()).toEqual({ credits: 5000, pilotName: 'ACE' });
    expect(next.save.reload).toHaveBeenCalledTimes(1);
    expect(loadMeta(d.storage).preferServer).toBe(false);
    // 受け取った後は、ふだんどおりローカルを送る
    next.service.localSaved();
    d.timers.advance(ONLINE_CONFIG.pushDebounceMs);
    await settle();
    expect(d.backend.calls.updateSave).toBe(1);
  });

  it('サーバーにバックアップが無ければ、ふだんどおり送って約束を下ろす', async () => {
    const d = await syncedDevice();
    d.backend.server = null;
    d.first.service.sync.preferServerOnce();
    d.clearLocal();
    const next = d.make();
    await next.service.start();
    await settle();
    expect(d.backend.server).not.toBeNull();
    expect(loadMeta(d.storage).preferServer).toBe(false);
  });

  it('ログアウト中に削除しても、次に連携したときにサーバーを受け取る', async () => {
    const d = await syncedDevice();
    await d.first.service.signOut();
    d.first.service.sync.preferServerOnce();
    d.clearLocal();
    d.backend.user = null;
    const next = d.make();
    await next.service.start();
    next.service.localSaved();
    d.timers.advance(ONLINE_CONFIG.pushDebounceMs);
    await settle();
    expect(d.local()).toEqual({ credits: 0, pilotName: null });
    d.backend.emitAuth(MEMBER);
    await settle();
    expect(d.local()).toEqual({ credits: 5000, pilotName: 'ACE' });
  });
});

describe('「サーバーのバックアップも削除する」', () => {
  it('サーバーの行を消し、同期の記録を捨てる。読み込み直した後は新しいセーブを insert で送る', async () => {
    const d = await syncedDevice();
    await d.first.service.sync.deleteServer();
    expect(d.backend.server).toBeNull();
    expect(d.backend.calls.deleteSave).toBe(1);
    const meta = loadMeta(d.storage);
    expect(meta).toMatchObject({ syncedUser: null, syncedServerAt: null, preferServer: false });
    d.clearLocal();
    const next = d.make();
    await next.service.start();
    await settle();
    expect(d.backend.calls.insertSave).toBe(2);
    expect(d.backend.server?.data).toEqual({ credits: 0, pilotName: null });
    expect(next.save.reload).not.toHaveBeenCalled();
  });

  it('連携していなければ消せない（例外）。消せなければ同期の記録はそのまま', async () => {
    const d = await syncedDevice();
    d.first.service.setEnabled(false);
    await expect(d.first.service.sync.deleteServer()).rejects.toMatchObject({ kind: 'denied' });
    d.first.service.setEnabled(true);
    d.backend.saveFailure = 'network';
    await expect(d.first.service.sync.deleteServer()).rejects.toMatchObject({ kind: 'network' });
    expect(loadMeta(d.storage).syncedUser).toBe('u1');
    expect(d.backend.server).not.toBeNull();
  });
});

describe('他の端末でバックアップを消したとき', () => {
  it('同期の記録が残っている端末も、サーバーに行が無ければ insert で送り直す（update の空振りを繰り返さない）', async () => {
    const d = await syncedDevice();
    d.backend.server = null;
    d.first.service.localSaved();
    d.timers.advance(ONLINE_CONFIG.pushDebounceMs);
    await settle();
    expect(d.backend.server).not.toBeNull();
    expect(d.first.hooks.report).not.toHaveBeenCalledWith('failed');
  });
});

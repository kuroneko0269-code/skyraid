// 8-1 の事前修正: 設定の「パイロット名を変更」。連携中はサーバーの表示名（profiles.display_name）も変える。
// 送れなかった（通信の失敗・オンライン連携 OFF）ときはローカルの名前は変えたまま、次に連携したときに送る。
// 8-6: 名前はパイロット名の 1 つ。連携したときにサーバーの表示名をパイロット名へ合わせる
import { describe, expect, it, vi } from 'vitest';
import { loadMeta } from '../src/online/meta';
import { OnlineService } from '../src/online/service';
import type { SaveAccess, SyncHooks } from '../src/online/sync';
import { ONLINE_CONFIG } from '../src/data/online';
import {
  MEMBER,
  ManualTimers,
  MemoryStorage,
  MockBackend,
  STRANGER,
  settle,
} from './online-helpers';

function setup(opts: { backend?: MockBackend; storage?: MemoryStorage; pilot?: string } = {}) {
  // 端末のパイロット名（設定で変えるとセーブが変わる。ここでは rename で変える）
  const pilot = { name: opts.pilot ?? 'ACE' };
  const backend = opts.backend ?? new MockBackend();
  backend.user ??= MEMBER;
  const storage = opts.storage ?? new MemoryStorage();
  const save = {
    data: () => ({ credits: 1 }),
    version: 9,
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
    storage,
    save,
    hooks,
    () => pilot.name,
    new ManualTimers(),
  );
  /** 設定の「パイロット名を変更」: セーブの名前を変えてからサーバーへ */
  const rename = (name: string) => {
    pilot.name = name;
    return service.renameFromPilot(name);
  };
  return { backend, storage, service, rename };
}

describe('パイロット名の変更とサーバーの表示名', () => {
  it('連携中: サーバーの表示名も変わる（ランキングの名前も新しくなる）', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    expect(t.backend.names.get('u1')).toBe('ACE');
    expect(await t.rename('FALCON')).toBe('saved');
    expect(t.backend.names.get('u1')).toBe('FALCON');
    expect(t.service.profileName).toBe('FALCON');
    expect(loadMeta(t.storage).pendingName).toBeNull();
  });

  it('送れなかった: deferred を返し、次の起動（連携）で送る。ローカルの名前は戻さない（呼び出し側の責任）', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    t.backend.nameFailure = 'network';
    expect(await t.rename('FALCON')).toBe('deferred');
    expect(t.backend.names.get('u1')).toBe('ACE');
    expect(loadMeta(t.storage).pendingName).toEqual({ user: 'u1', name: 'FALCON' });
    // 次の起動: 端末に残った変更を送る（サーバーの古い名前で上書きしない）
    t.backend.nameFailure = null;
    const again = setup({ backend: t.backend, storage: t.storage, pilot: 'FALCON' });
    await again.service.start();
    await settle();
    expect(t.backend.names.get('u1')).toBe('FALCON');
    expect(again.service.profileName).toBe('FALCON');
    expect(loadMeta(t.storage).pendingName).toBeNull();
  });

  it('オンライン連携 OFF: 送らずに覚え、ON に戻したときに送る', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    t.service.setEnabled(false);
    const before = t.backend.calls.saveDisplayName;
    expect(await t.rename('FALCON')).toBe('deferred');
    expect(t.backend.calls.saveDisplayName).toBe(before);
    t.service.setEnabled(true);
    await settle();
    expect(t.backend.names.get('u1')).toBe('FALCON');
  });

  it('承認待ち・未連携ではサーバーに触らない（none）', async () => {
    const pending = setup({ backend: Object.assign(new MockBackend(), { user: STRANGER }) });
    await pending.service.start();
    await settle();
    expect(await pending.rename('FALCON')).toBe('none');
    expect(pending.backend.calls.saveDisplayName).toBe(0);
    expect(loadMeta(pending.storage).pendingName).toBeNull();
  });

  it('8-6: サーバーの表示名がパイロット名と食い違っていたら、連携したときにパイロット名へ合わせる', async () => {
    const backend = new MockBackend();
    backend.user = MEMBER;
    backend.names.set('u1', 'Captain Ace');
    const t = setup({ backend });
    await t.service.start();
    await settle();
    expect(backend.names.get('u1')).toBe('ACE');
    expect(t.service.profileName).toBe('ACE');
    // 同じなら書かない
    const again = setup({ backend, storage: t.storage });
    const before = backend.calls.saveDisplayName;
    await again.service.start();
    await settle();
    expect(backend.calls.saveDisplayName).toBe(before);
  });

  it('8-6: 送れていない変更があっても、連携したときは今のパイロット名を送り、覚えた変更は消す', async () => {
    const t = setup();
    await t.service.start();
    await settle();
    t.backend.nameFailure = 'network';
    await t.rename('FALCON');
    t.backend.nameFailure = null;
    // その後パイロット名を ACE に戻した（setup の defaultName は ACE）
    const again = setup({ backend: t.backend, storage: t.storage });
    await again.service.start();
    await settle();
    expect(t.backend.names.get('u1')).toBe('ACE');
    expect(loadMeta(t.storage).pendingName).toBeNull();
  });

  it('別のユーザーの送れていない変更は送らない。壊れた値は読み捨てる', async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      ONLINE_CONFIG.storageKey,
      JSON.stringify({ pendingName: { user: 'someone-else', name: 'X' } }),
    );
    const t = setup({ storage });
    await t.service.start();
    await settle();
    expect(t.backend.names.get('u1')).toBe('ACE');
    storage.setItem(ONLINE_CONFIG.storageKey, JSON.stringify({ pendingName: { user: 1 } }));
    expect(loadMeta(storage).pendingName).toBeNull();
  });
});

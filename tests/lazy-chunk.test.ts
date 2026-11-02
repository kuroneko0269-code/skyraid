import { describe, expect, it, vi } from 'vitest';
import { classifyChunkFailure, lazyChunk, loadWithStatus } from '../src/core/lazy-chunk';

/** 時間は手で進める（setTimeout の代わり） */
function fakeTimers() {
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    set: (fn: () => void) => {
      timers.set(next, fn);
      return next++;
    },
    clear: (id: unknown) => {
      if (typeof id === 'number') timers.delete(id);
    },
    fire: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
}

describe('遅延読み込み（8-2）', () => {
  it('1 回だけ読み、読み込み済みは loaded で同期に取れる', async () => {
    const load = vi.fn(() => Promise.resolve({ v: 1 }));
    const chunk = lazyChunk(load);
    expect(chunk.loaded()).toBeNull();
    const [a, b] = await Promise.all([chunk(), chunk()]);
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
    expect(chunk.loaded()).toBe(a);
    await chunk();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('失敗は覚えず、次の呼び出しでやり直す', async () => {
    let fail = true;
    const load = vi.fn(() => (fail ? Promise.reject(new Error('404')) : Promise.resolve('ok')));
    const chunk = lazyChunk(load);
    await expect(chunk()).rejects.toThrow('404');
    expect(chunk.loaded()).toBeNull();
    fail = false;
    await expect(chunk()).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('失敗の理由: オフラインか、通信できるのに読めない（古いチャンク）', () => {
    expect(classifyChunkFailure(false)).toBe('offline');
    expect(classifyChunkFailure(true)).toBe('stale');
  });

  it('時間がかかると「読み込み中」を出し、終わったら消す。速ければ出さない', async () => {
    const t = fakeTimers();
    const log: string[] = [];
    const hooks = (online = true) => ({
      delayMs: 300,
      setTimer: t.set,
      clearTimer: t.clear,
      online: () => online,
      slow: () => log.push('slow'),
      done: () => log.push('done'),
      failed: (why: string) => log.push(`failed:${why}`),
    });
    // 速い（タイマーが鳴る前に終わる）
    await expect(loadWithStatus(() => Promise.resolve(1), hooks())).resolves.toBe(1);
    expect(log).toEqual(['done']);
    t.fire();
    expect(log).toEqual(['done']);
    // 遅い
    log.length = 0;
    let resolve: (v: number) => void = () => undefined;
    const slow = loadWithStatus(() => new Promise<number>((r) => (resolve = r)), hooks());
    t.fire();
    resolve(2);
    await expect(slow).resolves.toBe(2);
    expect(log).toEqual(['slow', 'done']);
    // 失敗（オフライン）は null
    log.length = 0;
    await expect(loadWithStatus(() => Promise.reject(new Error('x')), hooks(false))).resolves.toBe(
      null,
    );
    expect(log).toEqual(['failed:offline', 'done']);
  });
});

import { describe, expect, it } from 'vitest';
import { parseDebugFlags } from '../src/core/debug-flags';
import { FrameStats } from '../src/core/frame-stats';

describe('parseDebugFlags', () => {
  it('?debug でオーバーレイを初期表示する', () => {
    expect(parseDebugFlags('?debug')).toEqual({ overlay: true, logInput: false });
    expect(parseDebugFlags('?debug=')).toEqual({ overlay: true, logInput: false });
  });

  it('?debug=input は従来どおり入力ログを有効にする', () => {
    expect(parseDebugFlags('?debug=input')).toEqual({ overlay: true, logInput: true });
    expect(parseDebugFlags('?foo=1&debug=input')).toMatchObject({ logInput: true });
  });

  it('指定なしならどちらも無効', () => {
    expect(parseDebugFlags('')).toEqual({ overlay: false, logInput: false });
    expect(parseDebugFlags('?foo=debug')).toEqual({ overlay: false, logInput: false });
  });
});

describe('FrameStats', () => {
  it('集計期間ごとに平均 fps と frame ms を出す', () => {
    const stats = new FrameStats(0.5);
    // 1/64 秒は2進で正確に表せるので、32フレームでちょうど 0.5 秒になる
    for (let i = 0; i < 31; i++) expect(stats.record(1 / 64)).toBe(false);
    expect(stats.record(1 / 64)).toBe(true);
    expect(stats.latest.fps).toBeCloseTo(64, 5);
    expect(stats.latest.frameMs).toBeCloseTo(1000 / 64, 5);
  });

  it('集計期間に満たなければ更新しない', () => {
    const stats = new FrameStats(0.5);
    expect(stats.record(0.1)).toBe(false);
    expect(stats.latest.fps).toBe(0);
  });

  it('0・負・NaN は無視する', () => {
    const stats = new FrameStats(0.5);
    expect(stats.record(0)).toBe(false);
    expect(stats.record(-1)).toBe(false);
    expect(stats.record(Number.NaN)).toBe(false);
    expect(stats.record(0.5)).toBe(true);
    expect(stats.latest.fps).toBeCloseTo(2, 5);
  });
});

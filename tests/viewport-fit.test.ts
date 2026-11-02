// 8-6d: ルート要素（html・body）の大きさの選び方。iPhone を横向きのまま起動すると、起動直後の初期包含ブロック
// （CSS の 100%・documentElement.clientHeight）が小さいまま残り、下に黒い余白が出ていた
import { describe, expect, it } from 'vitest';
import { pickRootSize, type ViewportSample } from '../src/core/viewport-fit';

const IPHONE: ViewportSample = {
  inner: { width: 844, height: 390 },
  visual: { width: 844, height: 390, scale: 1 },
  client: { width: 844, height: 390 },
  screen: { width: 390, height: 844 },
  iosStandalone: false,
  landscape: true,
  capToScreen: true,
};

describe('pickRootSize（8-6d）', () => {
  it('どの値も同じなら、その大きさ', () => {
    expect(pickRootSize(IPHONE)).toMatchObject({ width: 844, height: 390 });
  });

  it('初期包含ブロック（client）だけ古い小さい値でも、inner・visualViewport の大きい方に広げる', () => {
    const s = { ...IPHONE, client: { width: 844, height: 343 } };
    expect(pickRootSize(s)).toMatchObject({ width: 844, height: 390 });
  });

  it('ホーム画面から起動（iOS）: inner も client も小さいままなら、screen の大きさ（向きに合わせる）を下限にする', () => {
    const s: ViewportSample = {
      ...IPHONE,
      inner: { width: 844, height: 343 },
      visual: { width: 844, height: 343, scale: 1 },
      client: { width: 844, height: 343 },
      iosStandalone: true,
    };
    expect(pickRootSize(s)).toMatchObject({ width: 844, height: 390, source: 'inner/screen' });
  });

  it('Safari（ホーム画面からではない）は screen を下限にしない（ツールバーの分を足さない）', () => {
    const s = {
      ...IPHONE,
      inner: { width: 750, height: 340 },
      visual: { width: 750, height: 340, scale: 1 },
      client: { width: 750, height: 340 },
    };
    expect(pickRootSize(s)).toMatchObject({ width: 750, height: 340 });
  });

  it('タッチの端末では screen の長辺・短辺（向きに合わせる）を超えない', () => {
    const s = { ...IPHONE, inner: { width: 844, height: 844 } };
    expect(pickRootSize(s)).toMatchObject({ width: 844, height: 390 });
    const portrait = {
      ...IPHONE,
      landscape: false,
      inner: { width: 390, height: 900 },
      visual: { width: 390, height: 844, scale: 1 },
      client: { width: 390, height: 844 },
    };
    expect(pickRootSize(portrait)).toMatchObject({ width: 390, height: 844 });
  });

  it('拡大中の visualViewport は使わない。0・NaN は無視する', () => {
    const s = {
      ...IPHONE,
      visual: { width: 400, height: 900, scale: 2 },
      client: { width: Number.NaN, height: 0 },
    };
    expect(pickRootSize(s)).toMatchObject({ width: 844, height: 390 });
  });

  it('PC（capToScreen なし）は screen を超えてもよい（縮小表示で inner が screen より大きい）', () => {
    const s = {
      ...IPHONE,
      screen: { width: 1920, height: 1080 },
      inner: { width: 3840, height: 2000 },
      visual: null,
      client: { width: 3840, height: 2000 },
      capToScreen: false,
    };
    expect(pickRootSize(s)).toMatchObject({ width: 3840, height: 2000 });
  });

  it('screen が読めなければ上限なし', () => {
    const s = { ...IPHONE, screen: { width: 0, height: 0 }, inner: { width: 1920, height: 1080 } };
    expect(pickRootSize(s)).toMatchObject({ width: 1920, height: 1080 });
  });
});

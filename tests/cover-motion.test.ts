// 10-1b: 幕のロゴの動きの計算（src/core/cover-motion.ts）
import { describe, expect, it } from 'vitest';
import {
  boxError,
  coverLogoBox,
  landProgress,
  mixBox,
  stepSpring,
  visibleBox,
  type SpringState,
} from '../src/core/cover-motion';
import { APP_SHELL_CONFIG, VIEWPORT_CONFIG } from '../src/data/app';

const C = VIEWPORT_CONFIG.coverLogo;
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

describe('幕のロゴの大きさと着く先', () => {
  it('幕の中のロゴはタイトルの画像と同じ式（幅の 46%・760px・高さの 24% に収まる）で中央', () => {
    // 844×390: 高さの 24% × 7（縦横比）= 655 > 幅の 46% = 388
    expect(coverLogoBox(rect(0, 0, 844, 390), 7, C)).toEqual({ cx: 422, cy: 195, w: 844 * 0.46 });
    // 844×200: 高さで決まる
    expect(coverLogoBox(rect(0, 0, 844, 200), 7, C).w).toBeCloseTo(200 * 0.24 * 7, 6);
    // 大きい画面は 760px まで
    expect(coverLogoBox(rect(0, 0, 3000, 2000), 7, C).w).toBe(760);
  });

  it('見えている画像の箱は object-fit: contain の余白を除く。文字は要素の箱のまま', () => {
    expect(visibleBox(rect(100, 50, 400, 40), 7)).toEqual({ cx: 300, cy: 70, w: 280 });
    expect(visibleBox(rect(100, 50, 140, 40), 7)).toEqual({ cx: 170, cy: 70, w: 140 });
    expect(visibleBox(rect(10, 20, 300, 80), 0)).toEqual({ cx: 160, cy: 60, w: 300 });
  });
});

describe('ばねの動き', () => {
  it('幕の大きさが変わると目標を少し行き過ぎてから落ち着く（揺れ）', () => {
    const s: SpringState = { box: { cx: 0, cy: 0, w: 300 }, v: { cx: 0, cy: 0, w: 0 } };
    const target = { cx: 0, cy: 31, w: 340 };
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(s, target, 1 / 60, C);
      peak = Math.max(peak, s.box.cy);
    }
    expect(peak).toBeGreaterThan(31.5);
    expect(peak).toBeLessThan(31 * 1.25);
    expect(boxError(s.box, target)).toBeLessThan(0.1);
  });

  it('移る進み具合は 0 から始まり、landMs で 1 にぴたりと着く。行き過ぎは 2 割未満', () => {
    expect(landProgress(0, C.landMs, C)).toBe(0);
    expect(landProgress(C.landMs, C.landMs, C)).toBe(1);
    let peak = 0;
    for (let ms = 0; ms <= C.landMs; ms += 4) peak = Math.max(peak, landProgress(ms, C.landMs, C));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.2);
    expect(Math.abs(landProgress(C.landMs - 1, C.landMs, C) - 1)).toBeLessThan(0.02);
  });

  it('移る時間とフェードを足しても、タイトルの展開アニメと合わせて 1.5 秒以内', () => {
    const total =
      C.landMs + VIEWPORT_CONFIG.nudge.coverFadeMs + APP_SHELL_CONFIG.titleDeploySeconds * 1000;
    expect(total).toBeLessThanOrEqual(1500);
  });

  it('mixBox は from → to を割合で混ぜる', () => {
    expect(mixBox({ cx: 0, cy: 0, w: 100 }, { cx: 10, cy: 20, w: 200 }, 0.5)).toEqual({
      cx: 5,
      cy: 10,
      w: 150,
    });
  });
});

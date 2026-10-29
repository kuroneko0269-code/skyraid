import { describe, expect, it } from 'vitest';
import { applyDeadzone, applyRadialDeadzone, sliderValueFromY } from '../src/core/analog';
import { FloatingStick } from '../src/core/touch-stick';
import { loadTouchMode, saveTouchMode, shouldShowTouchControls } from '../src/core/touch-settings';
import { TOUCH_CONFIG } from '../src/data/touch';
import type { StorageLike } from '../src/core/settings';

const opts = { radius: 100, deadzone: 0.1 };

describe('applyRadialDeadzone', () => {
  it('デッドゾーン内は 0、外側は 0〜1 に引き伸ばす', () => {
    const out = { x: 9, y: 9 };
    expect(applyRadialDeadzone(0.05, -0.05, 0.1, out)).toEqual({ x: 0, y: 0 });
    applyRadialDeadzone(0.55, 0, 0.1, out);
    expect(out.x).toBeCloseTo(0.5);
    applyRadialDeadzone(0, -2, 0.1, out);
    expect(out.y).toBeCloseTo(-1);
  });

  it('斜めでも方向を保つ', () => {
    const out = { x: 0, y: 0 };
    applyRadialDeadzone(0.5, 0.5, 0.1, out);
    expect(out.x).toBeCloseTo(out.y);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo((Math.SQRT1_2 - 0.1) / 0.9);
  });

  it('1軸のデッドゾーン', () => {
    expect(applyDeadzone(0.04, 0.05)).toBe(0);
    expect(applyDeadzone(1, 0.05)).toBe(1);
    expect(applyDeadzone(0.525, 0.05)).toBeCloseTo(0.5);
  });
});

describe('FloatingStick', () => {
  it('触れた位置が原点になり、そこからのずれで値を返す', () => {
    const s = new FloatingStick(opts);
    expect(s.start(1, 300, 400)).toBe(true);
    expect(s.value).toEqual({ x: 0, y: 0 });
    s.move(1, 355, 400);
    expect(s.value.x).toBeCloseTo(0.5);
    expect(s.value.y).toBeCloseTo(0);
    // 原点は別の場所でも同じずれなら同じ値
    s.end(1);
    s.start(2, 50, 600);
    s.move(2, 105, 600);
    expect(s.value.x).toBeCloseTo(0.5);
  });

  it('デッドゾーン内は 0（指の小さなぶれを拾わない）', () => {
    const s = new FloatingStick(opts);
    s.start(1, 0, 0);
    s.move(1, 6, -6);
    expect(s.value).toEqual({ x: 0, y: 0 });
  });

  it('半径を超えると ±1 で頭打ちになり、つまみも半径で止まる', () => {
    const s = new FloatingStick(opts);
    s.start(1, 0, 0);
    s.move(1, 0, 500);
    expect(s.value.y).toBeCloseTo(1);
    expect(s.knobY).toBeCloseTo(100);
    s.move(1, -300, 0);
    expect(s.value.x).toBeCloseTo(-1);
  });

  it('別の指は無視し、担当の指を離すと 0 に戻る（マルチタッチ）', () => {
    const s = new FloatingStick(opts);
    s.start(1, 0, 0);
    expect(s.start(2, 500, 500)).toBe(false);
    expect(s.move(2, 600, 600)).toBe(false);
    s.move(1, 100, 0);
    expect(s.end(2)).toBe(false);
    expect(s.value.x).toBeCloseTo(1);
    expect(s.end(1)).toBe(true);
    expect(s.active).toBe(false);
    expect(s.value).toEqual({ x: 0, y: 0 });
  });

  it('data/touch.ts の設定でも動く', () => {
    const s = new FloatingStick(TOUCH_CONFIG.stick);
    s.start(1, 0, 0);
    s.move(1, 0, -TOUCH_CONFIG.stick.radius);
    expect(s.value.y).toBeCloseTo(-1);
  });
});

describe('sliderValueFromY', () => {
  it('上端 1・下端 0、範囲外は頭打ち', () => {
    expect(sliderValueFromY(100, 100, 200)).toBe(1);
    expect(sliderValueFromY(300, 100, 200)).toBe(0);
    expect(sliderValueFromY(150, 100, 200)).toBeCloseTo(0.75);
    expect(sliderValueFromY(0, 100, 200)).toBe(1);
    expect(sliderValueFromY(999, 100, 200)).toBe(0);
  });
});

describe('タッチ操作の表示設定', () => {
  function memoryStorage(): StorageLike {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
  }

  it('auto はタッチ端末のときだけ表示、on / off は強制', () => {
    expect(shouldShowTouchControls('auto', true)).toBe(true);
    expect(shouldShowTouchControls('auto', false)).toBe(false);
    expect(shouldShowTouchControls('on', false)).toBe(true);
    expect(shouldShowTouchControls('off', true)).toBe(false);
  });

  it('保存・読み込みでき、不正値や例外は auto', () => {
    const storage = memoryStorage();
    expect(loadTouchMode(storage)).toBe('auto');
    saveTouchMode(storage, 'on');
    expect(loadTouchMode(storage)).toBe('on');
    storage.setItem(TOUCH_CONFIG.storageKey, 'bogus');
    expect(loadTouchMode(storage)).toBe('auto');
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadTouchMode(broken)).toBe('auto');
    expect(saveTouchMode(broken, 'off')).toBe(false);
    expect(loadTouchMode(null)).toBe('auto');
  });
});

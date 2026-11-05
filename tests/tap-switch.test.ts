// 画面の切り替え直後の押し抜け（9-9b）: 切り替えの前に押し始めたタップのクリックは、切り替え後の画面へ届けない
import { describe, expect, it } from 'vitest';
import { isStaleClick, pressTimeOf } from '../src/core/tap';
import { TAP_CONFIG } from '../src/data/touch';

describe('isStaleClick', () => {
  // 日替わりの「モード選択に戻る」: 押し始め 0ms → 離して自前の click() で切り替え 80ms → iOS の互換のクリック 90ms
  it('切り替えの前に押し始めたタップのクリックは捨てる（日替わり → モード選択の再現）', () => {
    expect(isStaleClick({ pressAt: 0, switchAt: 80, now: 90, fromPointer: true })).toBe(true);
    expect(isStaleClick({ pressAt: 0, switchAt: 80, now: 400, fromPointer: true })).toBe(true);
  });
  it('切り替えの後に押し始めたタップは通す（すばやく続けて押しても）', () => {
    expect(isStaleClick({ pressAt: 150, switchAt: 80, now: 230, fromPointer: true })).toBe(false);
  });
  it('切り替えを起こしたクリック自身は通す（切り替えの前に来る）', () => {
    expect(isStaleClick({ pressAt: 0, switchAt: -Infinity, now: 80, fromPointer: true })).toBe(
      false,
    );
  });
  it('キーボードのクリックは通す', () => {
    expect(isStaleClick({ pressAt: 0, switchAt: 80, now: 90, fromPointer: false })).toBe(false);
  });
  it('見張りの時間を過ぎたら通す', () => {
    const late = 80 + TAP_CONFIG.switchGuardMs + 1;
    expect(isStaleClick({ pressAt: 0, switchAt: 80, now: late, fromPointer: true })).toBe(false);
  });
});

describe('pressTimeOf', () => {
  it('タッチの直後のクリック（iOS の互換のクリック）はタッチの押し始め（互換の mousedown は使わない）', () => {
    expect(pressTimeOf(0, 95, 100)).toBe(0);
  });
  it('タッチが古ければマウスの押し始め（PC）', () => {
    expect(pressTimeOf(-Infinity, 95, 100)).toBe(95);
    expect(pressTimeOf(0, 9000, 9100)).toBe(9000);
  });
});

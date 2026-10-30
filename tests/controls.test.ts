// 操作設定（4-11）: 感度とデッドゾーンの変換・キー割当の重複の検出・セーブ v4 → v5 の移行・振動の対応判定
import { describe, expect, it } from 'vitest';
import {
  applySensitivity,
  buildKeyBindings,
  conflictsOf,
  defaultControls,
  findKeyConflicts,
  isAssignableCode,
  keyLabel,
  normalizeControls,
  quantize,
} from '../src/core/control-settings';
import { parseFlightOverrides } from '../src/core/flight-options';
import { Input } from '../src/core/input';
import { FloatingStick } from '../src/core/touch-stick';
import { Vibrator, vibrationSupported } from '../src/core/vibration';
import { CONTROL_SETTINGS, REMAPPABLE_ACTIONS } from '../src/data/controls';
import { DEFAULT_KEYBINDS } from '../src/data/keybinds';
import { SAVE_CONFIG } from '../src/data/save';
import { TOUCH_CONFIG } from '../src/data/touch';
import { createInitialSave, migrateSave } from '../src/progression/save';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';

class FakeStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('感度とデッドゾーンの変換', () => {
  it('初期値は 4-10 までの挙動と同じ（感度 1.0・デッドゾーン 12%・反転なし・オートレベル ON・中）', () => {
    const c = defaultControls();
    expect(c).toEqual({
      sensitivity: 1,
      deadzone: TOUCH_CONFIG.stick.deadzone,
      invertPitch: false,
      autoLevel: true,
      swapSides: false,
      vibration: false,
      buttonSize: 'medium',
      keys: {},
    });
    expect(CONTROL_SETTINGS.buttonScale[c.buttonSize]).toBe(1);
  });

  it('感度は値に掛けて 1 で頭打ち（0.6 倍で倒しきっても 0.6、1.6 倍で 0.625 から最大）', () => {
    expect(applySensitivity(1, 0.6)).toBeCloseTo(0.6);
    expect(applySensitivity(0.5, 1)).toBe(0.5);
    expect(applySensitivity(0.625, 1.6)).toBeCloseTo(1);
    expect(applySensitivity(0.9, 1.6)).toBe(1);
    expect(applySensitivity(0, 1.6)).toBe(0);
  });

  it('Input.axis: タッチ・パッドのピッチ・ロールにだけ感度を掛ける。キーボード・ヨー・スロットルは変えない', () => {
    const input = new Input();
    input.setAnalog('touch', 'pitchUp', 0.5);
    input.setAnalog('touch', 'rollLeft', 0.5);
    input.setAnalog('gamepad', 'yawRight', 0.5);
    expect(input.axis('pitchDown', 'pitchUp')).toBeCloseTo(0.5);
    input.stickSensitivity = 1.6;
    expect(input.axis('pitchDown', 'pitchUp')).toBeCloseTo(0.8);
    expect(input.axis('rollLeft', 'rollRight')).toBeCloseTo(-0.8);
    expect(input.axis('yawLeft', 'yawRight')).toBeCloseTo(0.5);
    input.stickSensitivity = 0.6;
    input.handleKeyDown({ code: 'KeyS' });
    // キーボード（1）+ タッチ（0.5 × 0.6）は ±1 で頭打ち
    expect(input.axis('pitchDown', 'pitchUp')).toBe(1);
    input.handleKeyUp({ code: 'KeyS' });
    input.setAnalog('touch', 'pitchUp', 1);
    expect(input.axis('pitchDown', 'pitchUp')).toBeCloseTo(0.6);
  });

  it('スティックのデッドゾーンを変えられる（12% → 25% で、半径の 20% の倒しは 0）', () => {
    const r = TOUCH_CONFIG.stick.radius;
    const stick = new FloatingStick(TOUCH_CONFIG.stick);
    stick.start(1, 100, 100);
    stick.move(1, 100, 100 + r * 0.2);
    expect(stick.value.y).toBeCloseTo((0.2 - 0.12) / (1 - 0.12));
    stick.setDeadzone(0.25);
    stick.move(1, 100, 100 + r * 0.2);
    expect(stick.value.y).toBe(0);
    stick.move(1, 100, 100 + r);
    expect(stick.value.y).toBeCloseTo(1);
    // 元の設定（data/touch.ts）は書き換えない
    expect(TOUCH_CONFIG.stick.deadzone).toBe(0.12);
  });

  it('保存した値は範囲に収めて刻みにそろえる。不正な値は初期値', () => {
    const s = CONTROL_SETTINGS.sensitivity;
    expect(quantize(2, s, 1)).toBe(1.6);
    expect(quantize(0.1, s, 1)).toBe(0.6);
    expect(quantize(0.73, s, 1)).toBe(0.7);
    expect(quantize('x', s, 1)).toBe(1);
    expect(quantize(0.3, CONTROL_SETTINGS.deadzone, 0.12)).toBe(0.25);
    const c = normalizeControls({
      sensitivity: 1.25,
      deadzone: 0.051,
      invertPitch: true,
      autoLevel: 'no',
      swapSides: true,
      vibration: 1,
      buttonSize: 'huge',
      keys: { fire: 'KeyJ', missile: 'Escape', flare: 42, bomb: 'KeyK' },
    });
    expect(c.sensitivity).toBe(1.3);
    expect(c.deadzone).toBe(0.05);
    expect([c.invertPitch, c.autoLevel, c.swapSides, c.vibration]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(c.buttonSize).toBe('medium');
    // Esc・数値・変えられないアクション（爆弾）は捨てる
    expect(c.keys).toEqual({ fire: 'KeyJ' });
  });

  it('URL の ?invert / ?autolevel は指定した項目だけ設定より優先する', () => {
    expect(parseFlightOverrides('')).toEqual({});
    expect(parseFlightOverrides('?invert')).toEqual({ invertPitch: true });
    expect(parseFlightOverrides('?autolevel=off')).toEqual({ autoLevel: false });
  });
});

describe('キー割当', () => {
  it('変えられるのは主要 12 アクション。初期の割当には重複がない', () => {
    expect(REMAPPABLE_ACTIONS.length).toBe(12);
    expect(findKeyConflicts(DEFAULT_KEYBINDS).size).toBe(0);
    expect(buildKeyBindings({})).toEqual(DEFAULT_KEYBINDS);
  });

  it('主キー（WASD 側）を差し替え、矢印キーは残す', () => {
    const b = buildKeyBindings({ pitchDown: 'KeyI', throttleUp: 'KeyU' });
    expect(b.pitchDown).toEqual(['KeyI', 'ArrowUp']);
    expect(b.throttleUp).toEqual(['KeyU', 'ShiftRight']);
    expect(b.fire).toEqual(['Space']);
    // 残す方と同じキーなら 1 つにまとめる
    expect(buildKeyBindings({ pitchDown: 'ArrowUp' }).pitchDown).toEqual(['ArrowUp']);
  });

  it('重複の検出: 変えられないアクション（カメラ C）や、ほかの割当（機銃 Space）と重なると警告の相手を返す', () => {
    const b = buildKeyBindings({ pitchDown: 'KeyC', missile: 'Space' });
    const conflicts = findKeyConflicts(b);
    expect(conflicts.get('KeyC')).toEqual(['pitchDown', 'cameraToggle']);
    expect(conflicts.get('Space')).toEqual(['fire', 'missile']);
    expect(conflictsOf(b, 'pitchDown')).toEqual(['cameraToggle']);
    expect(conflictsOf(b, 'fire')).toEqual(['missile']);
    expect(conflictsOf(b, 'flare')).toEqual([]);
    // 重複しても両方のアクションが効く（Input は 1 つのキーから複数のアクションを出せる）
    const input = new Input(b);
    input.handleKeyDown({ code: 'Space' });
    expect([input.isDown('fire'), input.isDown('missile')]).toEqual([true, true]);
  });

  it('割り当てられないキーは Esc（取り消し）と変な値。表示名は W・↑・Shift', () => {
    expect(isAssignableCode('Escape')).toBe(false);
    expect(isAssignableCode('')).toBe(false);
    expect(isAssignableCode('KeyJ')).toBe(true);
    expect(isAssignableCode('Digit1')).toBe(true);
    expect([
      keyLabel('KeyW'),
      keyLabel('ArrowUp'),
      keyLabel('ShiftLeft'),
      keyLabel('Digit1'),
    ]).toEqual(['W', '↑', 'Shift', '1']);
  });
});

describe('セーブ v5（操作設定と案内の記録）', () => {
  it('v4 → v5: 操作は初期値（今の挙動）、案内はまだ出していない扱い。ほかの設定・印は残る', () => {
    const v5 = createInitialSave();
    const v4: Record<string, unknown> = {
      ...v5,
      version: 4,
      settings: { ...v5.settings, hud: false, difficulty: 'hard' },
    };
    delete (v4.settings as Record<string, unknown>).controls;
    delete v4.flags;
    const save = migrateSave(v4);
    expect(save?.version).toBe(5);
    expect(SAVE_CONFIG.version).toBe(5);
    expect(save?.settings.controls).toEqual(defaultControls());
    expect(save?.flags).toEqual({
      tutorialOffered: false,
      tutorialDone: false,
      hintsFree: false,
      hintsMission: false,
    });
    expect(save?.settings.hud).toBe(false);
    expect(save?.settings.difficulty).toBe('hard');
  });

  it('操作の設定と案内の印を保存して読み直せる', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    store.updateControls((c) => {
      c.sensitivity = 1.4;
      c.swapSides = true;
      c.keys.fire = 'KeyJ';
    });
    store.setFlag('tutorialOffered');
    const again = SaveStore.open(storage).store;
    expect(again.settings.controls.sensitivity).toBe(1.4);
    expect(again.settings.controls.swapSides).toBe(true);
    expect(again.settings.controls.keys).toEqual({ fire: 'KeyJ' });
    expect(again.flag('tutorialOffered')).toBe(true);
    expect(again.flag('tutorialDone')).toBe(false);
  });
});

describe('振動', () => {
  it('Android で Vibration API があるときだけ。iOS（API なし）・PC（関数はある）は非対応', () => {
    const calls: number[] = [];
    const android = {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130',
      vibrate: (ms: number) => calls.push(ms) > 0,
    };
    expect(vibrationSupported(android)).toBe(true);
    expect(vibrationSupported({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })).toBe(
      false,
    );
    expect(
      vibrationSupported({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', vibrate: () => true }),
    ).toBe(false);
    const v = new Vibrator(android);
    v.pulse('hit');
    expect(calls).toEqual([]);
    v.enabled = true;
    v.pulse('hit');
    v.pulse('kill');
    expect(calls).toEqual([CONTROL_SETTINGS.vibration.hit, CONTROL_SETTINGS.vibration.kill]);
  });
});

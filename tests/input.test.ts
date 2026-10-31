import { describe, expect, it } from 'vitest';
import { Input } from '../src/core/input';
import {
  ACTIONS,
  ANALOG_ONLY_ACTIONS,
  DEFAULT_KEYBINDS,
  type KeyBindings,
} from '../src/data/keybinds';

/** node の Event に code を足した疑似キーイベント */
function keyEvent(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  const e = new Event(type, { cancelable: true });
  return Object.assign(e, { code, repeat });
}

function setup(bindings?: KeyBindings) {
  const target = new EventTarget();
  const input = new Input(bindings);
  input.attach(target);
  const down = (code: string, repeat = false) =>
    target.dispatchEvent(keyEvent('keydown', code, repeat));
  const up = (code: string) => target.dispatchEvent(keyEvent('keyup', code));
  return { target, input, down, up };
}

describe('keybinds', () => {
  it('全アクションに少なくとも1つキーが割り当てられている（タッチ・パッドの長押し専用を除く）', () => {
    for (const action of ACTIONS) {
      if (ANALOG_ONLY_ACTIONS.includes(action)) expect(DEFAULT_KEYBINDS[action]).toEqual([]);
      else expect(DEFAULT_KEYBINDS[action].length).toBeGreaterThan(0);
    }
  });
});

describe('Input', () => {
  it('物理キーではなくアクション名で押下状態を取得できる', () => {
    const { input, down, up } = setup();
    expect(input.isDown('rollLeft')).toBe(false);
    down('KeyA');
    expect(input.isDown('rollLeft')).toBe(true);
    expect(input.isDown('rollRight')).toBe(false);
    up('KeyA');
    expect(input.isDown('rollLeft')).toBe(false);
  });

  it('同じアクションの複数キーは片方を離しても押下が続く', () => {
    const { input, down, up } = setup();
    down('KeyW');
    down('ArrowUp');
    up('KeyW');
    expect(input.isDown('pitchDown')).toBe(true);
    up('ArrowUp');
    expect(input.isDown('pitchDown')).toBe(false);
  });

  it('wasPressed は押した瞬間だけ true で、endStep でリセットされる', () => {
    const { input, down } = setup();
    down('Space');
    expect(input.wasPressed('fire')).toBe(true);
    input.endStep();
    expect(input.wasPressed('fire')).toBe(false);
    // キーリピートでは再度 true にならない
    down('Space', true);
    down('Space');
    expect(input.wasPressed('fire')).toBe(false);
    expect(input.isDown('fire')).toBe(true);
  });

  it('ステップ間に押して離した入力も取りこぼさない', () => {
    const { input, down, up } = setup();
    down('KeyF');
    up('KeyF');
    expect(input.isDown('missile')).toBe(false);
    expect(input.wasPressed('missile')).toBe(true);
  });

  it('axis は -1 / 0 / +1 を返す', () => {
    const { input, down, up } = setup();
    expect(input.axis('throttleDown', 'throttleUp')).toBe(0);
    down('ShiftLeft');
    expect(input.axis('throttleDown', 'throttleUp')).toBe(1);
    down('KeyZ');
    expect(input.axis('throttleDown', 'throttleUp')).toBe(0);
    up('ShiftLeft');
    expect(input.axis('throttleDown', 'throttleUp')).toBe(-1);
  });

  it('割り当てたキーは preventDefault し、未割当キーは触らない', () => {
    const { target } = setup();
    const tab = keyEvent('keydown', 'Tab');
    target.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    const other = keyEvent('keydown', 'KeyJ');
    target.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('blur で全キーが離された扱いになる', () => {
    const { target, input, down } = setup();
    down('KeyD');
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('rollRight')).toBe(false);
  });

  it('割当を差し替えられる', () => {
    const { input, down } = setup({ ...DEFAULT_KEYBINDS, fire: ['KeyJ'] });
    down('Space');
    expect(input.isDown('fire')).toBe(false);
    down('KeyJ');
    expect(input.isDown('fire')).toBe(true);
  });

  it('detach 後はイベントを受け取らない', () => {
    const { input, down } = setup();
    input.detach();
    down('KeyQ');
    expect(input.isDown('yawLeft')).toBe(false);
  });
});

describe('Input（連続値）', () => {
  it('タッチの連続値は axis にそのまま出る。キーボードは ±1 のまま', () => {
    const { input, down, up } = setup();
    input.setAnalog('touch', 'rollRight', 0.3);
    expect(input.axis('rollLeft', 'rollRight')).toBeCloseTo(0.3);
    expect(input.value('rollRight')).toBeCloseTo(0.3);
    input.setAnalog('touch', 'rollRight', 0);
    down('KeyA');
    expect(input.axis('rollLeft', 'rollRight')).toBe(-1);
    up('KeyA');
  });

  it('系統をまたいだ合計は ±1 で頭打ち', () => {
    const { input, down } = setup();
    down('KeyS');
    input.setAnalog('gamepad', 'pitchUp', 0.8);
    expect(input.axis('pitchDown', 'pitchUp')).toBe(1);
    input.setAnalog('touch', 'pitchDown', 0.5);
    expect(input.axis('pitchDown', 'pitchUp')).toBeCloseTo(1);
  });

  it('しきい値で isDown / wasPressed になり、ヒステリシスで離す', () => {
    const { input } = setup();
    input.setAnalog('gamepad', 'yawLeft', 0.4);
    expect(input.isDown('yawLeft')).toBe(false);
    input.setAnalog('gamepad', 'yawLeft', 0.6);
    expect(input.isDown('yawLeft')).toBe(true);
    expect(input.wasPressed('yawLeft')).toBe(true);
    input.endStep();
    input.setAnalog('gamepad', 'yawLeft', 0.4);
    expect(input.isDown('yawLeft')).toBe(true);
    expect(input.wasPressed('yawLeft')).toBe(false);
    input.setAnalog('gamepad', 'yawLeft', 0.2);
    expect(input.isDown('yawLeft')).toBe(false);
  });

  it('clearAnalog は指定した系統だけ離す', () => {
    const { input } = setup();
    input.setAnalog('touch', 'fire', 1);
    input.setAnalog('gamepad', 'missile', 1);
    input.clearAnalog('touch');
    expect(input.isDown('fire')).toBe(false);
    expect(input.isDown('missile')).toBe(true);
  });

  it('スロットル位置の直接指定は 1 回だけ受け取れる', () => {
    const { input } = setup();
    expect(input.takeThrottleTarget()).toBeNull();
    input.setThrottleTarget(1.5);
    expect(input.takeThrottleTarget()).toBe(1);
    expect(input.takeThrottleTarget()).toBeNull();
  });

  it('blur で連続値も離される', () => {
    const { target, input } = setup();
    input.setAnalog('touch', 'afterburner', 1);
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('afterburner')).toBe(false);
  });
});

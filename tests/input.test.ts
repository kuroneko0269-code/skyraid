import { describe, expect, it } from 'vitest';
import { Input } from '../src/core/input';
import { ACTIONS, DEFAULT_KEYBINDS, type KeyBindings } from '../src/data/keybinds';

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
  it('全アクションに少なくとも1つキーが割り当てられている', () => {
    for (const action of ACTIONS) {
      expect(DEFAULT_KEYBINDS[action].length).toBeGreaterThan(0);
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
    const other = keyEvent('keydown', 'KeyP');
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

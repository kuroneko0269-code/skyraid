import { describe, expect, it } from 'vitest';
import {
  GamepadInput,
  actionIndex,
  createActionValues,
  mapGamepad,
  type GamepadLike,
} from '../src/core/gamepad';
import { Input } from '../src/core/input';
import type { Action } from '../src/data/keybinds';

function pad(axes: number[] = [0, 0, 0, 0], pressed: Record<number, number> = {}): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = pressed[i] ?? 0;
    return { value, pressed: value > 0.5 };
  });
  return { connected: true, axes, buttons };
}

function valueOf(values: Float32Array, action: Action): number {
  return values[actionIndex(action)] ?? 0;
}

describe('mapGamepad', () => {
  it('左スティック: 前に倒すと機首下げ、右でロール右', () => {
    const v = mapGamepad(pad([0, -1, 0, 0]), createActionValues());
    expect(valueOf(v, 'pitchDown')).toBeCloseTo(1);
    expect(valueOf(v, 'pitchUp')).toBe(0);
    mapGamepad(pad([0.6, 0, 0, 0]), v);
    expect(valueOf(v, 'rollRight')).toBeCloseTo((0.6 - 0.15) / 0.85);
    expect(valueOf(v, 'pitchDown')).toBe(0);
  });

  it('スティックのデッドゾーン内は 0', () => {
    const v = mapGamepad(pad([0.1, -0.1, 0.05, 0.1]), createActionValues());
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
  });

  it('右スティック上下がスロットル', () => {
    const v = mapGamepad(pad([0, 0, 0, -1]), createActionValues());
    expect(valueOf(v, 'throttleUp')).toBeCloseTo(1);
    mapGamepad(pad([0, 0, 0, 1]), v);
    expect(valueOf(v, 'throttleDown')).toBeCloseTo(1);
    expect(valueOf(v, 'throttleUp')).toBe(0);
  });

  it('spec.md の操作表どおりのボタン割当（LT/RT はアナログ）', () => {
    const v = mapGamepad(
      pad(undefined, { 0: 1, 1: 1, 3: 1, 4: 1, 5: 1, 6: 0.5, 7: 1, 8: 1 }),
      createActionValues(),
    );
    expect(valueOf(v, 'missile')).toBe(1); // A
    expect(valueOf(v, 'flare')).toBe(1); // B
    expect(valueOf(v, 'targetNext')).toBe(1); // Y
    expect(valueOf(v, 'afterburner')).toBe(1); // LB
    expect(valueOf(v, 'fire')).toBe(1); // RB
    expect(valueOf(v, 'yawLeft')).toBeCloseTo((0.5 - 0.05) / 0.95); // LT
    expect(valueOf(v, 'yawRight')).toBe(1); // RT
    expect(valueOf(v, 'cameraToggle')).toBe(1); // Back
    expect(valueOf(v, 'debugToggle')).toBe(0);
  });
});

describe('GamepadInput', () => {
  function setup(pads: (GamepadLike | null)[]) {
    const input = new Input();
    const events = new EventTarget();
    const gp = new GamepadInput(input, () => pads);
    gp.attach(events);
    return { input, events, gp };
  }

  it('接続イベントまでは読まず、接続後は Input に連続値を書く', () => {
    const pads: (GamepadLike | null)[] = [null, pad([0, 0.575, 0, 0], { 5: 1 })];
    const { input, events, gp } = setup(pads);
    gp.poll();
    expect(input.isDown('fire')).toBe(false);
    events.dispatchEvent(new Event('gamepadconnected'));
    gp.poll();
    expect(input.isDown('fire')).toBe(true);
    expect(input.wasPressed('fire')).toBe(true);
    expect(input.axis('pitchDown', 'pitchUp')).toBeCloseTo(0.5);
  });

  it('切断すると入力が離される', () => {
    const { input, events, gp } = setup([pad([1, 0, 0, 0], { 4: 1 })]);
    events.dispatchEvent(new Event('gamepadconnected'));
    gp.poll();
    expect(input.isDown('afterburner')).toBe(true);
    events.dispatchEvent(new Event('gamepaddisconnected'));
    gp.poll();
    expect(input.isDown('afterburner')).toBe(false);
    expect(input.axis('rollLeft', 'rollRight')).toBe(0);
  });
});

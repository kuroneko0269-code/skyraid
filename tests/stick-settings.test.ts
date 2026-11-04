// スティックの改善（9-2）の設定まわり: 操縦の方式・感度のカーブ・スティックの位置の保存と読み込み（今の利用者にも新しい初期値）、
// カーブの計算、「方向へ倒す」方式の入力（タッチで操作しているときだけ・ピッチ反転・ヨーのボタン）、一度だけのお知らせ、
// チュートリアルの文
import { beforeAll, describe, expect, it } from 'vitest';
import { applyStickCurve } from '../src/core/analog';
import { defaultControls, normalizeControls } from '../src/core/control-settings';
import { Input } from '../src/core/input';
import { SteerControl } from '../src/core/steer-control';
import { STEER_DEFAULTS, STICK_CURVES } from '../src/data/steer';
import { Aircraft, createControls } from '../src/entities/aircraft';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';
import { markSteerNoticeForNewPilot, takeSteerNotice } from '../src/progression/steer-notice';
import { tutorialStepText } from '../src/ui/tutorial-text';
import { useLocale } from './i18n-helpers';

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

describe('設定の保存と読み込み', () => {
  it('初期値は 方向へ倒す・カーブ 1.5・親指を置いた場所', () => {
    const c = defaultControls();
    expect([c.steerMode, c.stickCurve, c.stickPosition]).toEqual(['direct', 1.5, 'floating']);
    expect(STEER_DEFAULTS.curve).toBe(1.5);
    expect(STICK_CURVES).toEqual([1, 1.5, 2]);
  });

  it('9-1 までのセーブ（項目が無い）は新しい初期値で読む（今の利用者にも当てる）。ほかの設定はそのまま', () => {
    const c = normalizeControls({ sensitivity: 1.3, deadzone: 0.2, autoLevel: false });
    expect(c.steerMode).toBe('direct');
    expect(c.stickCurve).toBe(1.5);
    expect(c.stickPosition).toBe('floating');
    expect(c.sensitivity).toBe(1.3);
    expect(c.deadzone).toBe(0.2);
    expect(c.autoLevel).toBe(false);
  });

  it('選んだ値は保存して読み直せる。不正な値は初期値', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    store.updateControls((c) => {
      c.steerMode = 'classic';
      c.stickCurve = 2;
      c.stickPosition = 'fixed';
    });
    const again = SaveStore.open(storage).store.settings.controls;
    expect([again.steerMode, again.stickCurve, again.stickPosition]).toEqual([
      'classic',
      2,
      'fixed',
    ]);
    const bad = normalizeControls({ steerMode: 'joystick', stickCurve: 3, stickPosition: 'left' });
    expect([bad.steerMode, bad.stickCurve, bad.stickPosition]).toEqual(['direct', 1.5, 'floating']);
  });
});

describe('感度のカーブ', () => {
  it('倒し具合（長さ）を ^カーブ にする。向きは保ち、端（1）は 1 のまま。1.0 はそのまま', () => {
    expect(applyStickCurve({ x: 0.5, y: 0 }, 1)).toEqual({ x: 0.5, y: 0 });
    const v = applyStickCurve({ x: 0.3, y: 0.4 }, 1.5);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(0.5 ** 1.5, 10);
    expect(v.x / v.y).toBeCloseTo(0.75, 10);
    const e = applyStickCurve({ x: 0.6, y: -0.8 }, 2);
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(1, 10);
    expect(applyStickCurve({ x: 0, y: 0 }, 2)).toEqual({ x: 0, y: 0 });
  });

  it('中央付近ほど細かい（倒し具合 0.3 で 1.0: 0.3 / 1.5: 0.16 / 2.0: 0.09）', () => {
    const at = (c: number): number => applyStickCurve({ x: 0.3, y: 0 }, c).x;
    expect(at(1)).toBeCloseTo(0.3);
    expect(at(1.5)).toBeCloseTo(0.164, 3);
    expect(at(2)).toBeCloseTo(0.09);
  });
});

describe('「方向へ倒す」方式の入力', () => {
  const setup = (): { input: Input; steer: SteerControl; plane: Aircraft } => {
    const input = new Input();
    const plane = new Aircraft(undefined, { autoLevel: true }, undefined, () => 0);
    plane.respawn({ x: 0, y: 1000, z: 0 });
    return { input, steer: new SteerControl(input, plane, () => 0), plane };
  };

  it('タッチで操作しているときだけ組み立てる（キーボード・パッドを触ると今までどおり）', () => {
    const { input, steer } = setup();
    input.directMode = true;
    expect(steer.active).toBe(false);
    input.setDirectStick(0, 1);
    expect(steer.active).toBe(true);
    const c = createControls();
    steer.apply(c);
    expect(c.pitch).toBeGreaterThan(0.5);
    // キーを押したら、組み立てない（キーボードの値のまま）
    input.handleKeyDown({ code: 'KeyA' });
    expect(steer.active).toBe(false);
    const k = createControls();
    k.pitch = 0.25;
    steer.apply(k);
    expect(k.pitch).toBe(0.25);
  });

  it('ピッチ・ロールの方式では組み立てない', () => {
    const { input, steer } = setup();
    input.directMode = false;
    input.setDirectStick(0, 1);
    expect(steer.active).toBe(false);
  });

  it('ピッチ反転の設定でも「上へ倒す = 上がる」（飛行モデルの反転を先に戻す）', () => {
    const { input, steer, plane } = setup();
    input.directMode = true;
    input.setDirectStick(0, 1);
    const normal = createControls();
    steer.apply(normal);
    plane.flight.options.invertPitch = true;
    const inverted = createControls();
    steer.apply(inverted);
    expect(inverted.pitch).toBeCloseTo(-normal.pitch, 10);
  });

  it('感度は合成の大きさに掛けて 1 で頭打ち。ヨーのボタンは足す', () => {
    const { input, steer } = setup();
    input.directMode = true;
    input.setDirectStick(0.2, 0);
    const a = createControls();
    steer.apply(a);
    input.stickSensitivity = 1.6;
    const b = createControls();
    steer.apply(b);
    expect(Math.abs(b.yaw)).toBeGreaterThan(Math.abs(a.yaw));
    input.setAnalog('touch', 'yawLeft', 1);
    const y = createControls();
    steer.apply(y);
    expect(y.yaw).toBeLessThan(b.yaw);
  });

  it('タッチ操作を隠す（clearAnalog）と、スティックは 0', () => {
    const { input } = setup();
    input.setDirectStick(0.5, -0.5);
    input.clearAnalog('touch');
    expect(input.directStick).toEqual({ x: 0, y: 0 });
  });
});

describe('「操作方法が新しくなりました」は今の利用者に一度だけ', () => {
  it('初回起動の人（名前がまだ）には出さない', () => {
    const store = SaveStore.open(new FakeStorage()).store;
    markSteerNoticeForNewPilot(store);
    expect(takeSteerNotice(store)).toBe(false);
  });

  it('名前のある（今の）利用者には 1 回だけ出す。読み直しても出さない', () => {
    const storage = new FakeStorage();
    const store = SaveStore.open(storage).store;
    store.setPilotName('ACE');
    const again = SaveStore.open(storage).store;
    markSteerNoticeForNewPilot(again);
    expect(takeSteerNotice(again)).toBe(true);
    expect(takeSteerNotice(again)).toBe(false);
    expect(takeSteerNotice(SaveStore.open(storage).store)).toBe(false);
  });
});

describe('チュートリアルの文（9-5c で章ごと・方式ごとに）', () => {
  beforeAll(() => {
    useLocale('ja');
  });

  it('操縦の章: 方式ごとの文（方向へ倒す / ピッチ・ロール / 傾き / ドラッグ）。キーボード・パッドは別の文', () => {
    const name = (a: string): string => a;
    expect(tutorialStepText('steer', 'rings', 'direct', name)).toContain('行きたい方向');
    expect(tutorialStepText('steer', 'rings', 'classic', name)).toContain('傾け');
    expect(tutorialStepText('steer', 'rings', 'tilt', name)).toContain('端末');
    expect(tutorialStepText('steer', 'rings', 'drag', name)).toContain('指で押さえる');
    expect(tutorialStepText('steer', 'rings', 'keys', name)).toContain('pitchUp');
    expect(tutorialStepText('steer', 'rings', 'pad', name)).toContain('左スティック');
    // 方式で文の違わない段階（ボタン）は、タッチの 4 方式で同じ
    expect(tutorialStepText('speed', 'ab', 'classic', name)).toBe(
      tutorialStepText('speed', 'ab', 'direct', name),
    );
    useLocale('en');
    expect(tutorialStepText('steer', 'rings', 'tilt', name)).toContain('Tilt the device');
    expect(tutorialStepText('steer', 'rings', 'drag', name)).toContain('Hold your finger');
    useLocale('ja');
  });

  it('宙返りの章は方式ごとに倒し方を書く（方向へ倒す = 上へ倒し続ける・ピッチとロール = 引き続ける）', () => {
    const name = (a: string): string => a;
    expect(tutorialStepText('loop', 'loopTop', 'direct', name)).toContain('上へ倒し続ける');
    expect(tutorialStepText('loop', 'loopTop', 'classic', name)).toContain('引き続ける');
    expect(tutorialStepText('gun', 'targets', 'direct', name)).toContain('自動');
    expect(tutorialStepText('gun', 'targets', 'keys', name)).toContain('fire');
  });
});

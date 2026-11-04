import { describe, expect, it } from 'vitest';
import { applyAssistPreset, assistPresetOf } from '../src/core/assist-preset';
import { defaultControls, normalizeControls } from '../src/core/control-settings';
import { ASSIST_PRESET_DEFAULT, ASSIST_PRESET_VALUES } from '../src/data/assist';
import { practiceSettingsLabel } from '../src/ui/practice-text';
import {
  FlightTips,
  tipAllowed,
  tipDirection,
  type TipDirection,
} from '../src/missions/practice/tips';
import { defaultFlags } from '../src/progression/save';

describe('補助の組（9-5d）', () => {
  it('3 つの組の値・初期値はかんたん（今までの初期値）', () => {
    expect(ASSIST_PRESET_VALUES).toEqual({
      easy: { aimAssist: 'normal', autoFire: true, speedMatch: true },
      normal: { aimAssist: 'normal', autoFire: false, speedMatch: false },
      hard: { aimAssist: 'weak', autoFire: false, speedMatch: false },
    });
    expect(ASSIST_PRESET_DEFAULT).toBe('easy');
    expect(assistPresetOf(defaultControls())).toBe('easy');
    // 9-5c までのセーブ（3 つが初期値）もかんたん
    expect(assistPresetOf(normalizeControls({}))).toBe('easy');
  });

  it('組を選ぶと 3 つだけ変わる。個別に変えるとカスタム', () => {
    const c = defaultControls();
    c.stickCurve = 2;
    applyAssistPreset(c, 'hard');
    expect(assistPresetOf(c)).toBe('hard');
    expect(c.stickCurve).toBe(2);
    expect(c.steerMode).toBe(defaultControls().steerMode);
    applyAssistPreset(c, 'normal');
    expect(assistPresetOf(c)).toBe('normal');
    c.aimAssist = 'strong';
    expect(assistPresetOf(c)).toBe('custom');
    c.aimAssist = 'normal';
    c.speedMatch = true;
    expect(assistPresetOf(c)).toBe('custom');
  });

  it('一度だけの印は無いセーブでは false（今の利用者にも 1 回出す）', () => {
    expect(defaultFlags().assistPreset).toBe(false);
  });

  it('練習場の一覧の短い見出しは組の名前にまとめる（違えば全部）', () => {
    expect(practiceSettingsLabel('touch:direct:normal:1:1.5:s', true)).toBe(
      'タッチ・方向へ倒す・かんたん・カーブ 1.5',
    );
    expect(practiceSettingsLabel('touch:direct:weak:0:1.5', true)).toContain('むずかしい');
    expect(practiceSettingsLabel('touch:direct:strong:1:1.5', true)).toContain('補助 強');
    expect(practiceSettingsLabel('touch:direct:off:1:1.5:s', true)).toContain('自動射撃');
    expect(practiceSettingsLabel('keyboard', true)).toBe('キーボード');
  });
});

describe('飛行中の一言の出し分け（9-5d）', () => {
  const touch = (autoFire: boolean, speedMatch: boolean) => ({ touch: true, autoFire, speedMatch });

  it('自動に任せている物は出さない（かんたんは見失いだけ・ふつう / むずかしいは全部・キーボードは全部）', () => {
    const easy = touch(true, true);
    expect(tipAllowed('overtake', easy)).toBe(false);
    expect(tipAllowed('offRange', easy)).toBe(false);
    expect(tipAllowed('lost', easy)).toBe(true);
    for (const a of [touch(false, false), { touch: false, autoFire: false, speedMatch: false }])
      for (const tip of ['overtake', 'offRange', 'lost'] as const)
        expect(tipAllowed(tip, a)).toBe(true);
    expect(tipAllowed('offRange', touch(true, false))).toBe(false);
    expect(tipAllowed('overtake', touch(true, false))).toBe(true);
  });

  it('出さない一言は次の候補に譲る（追い越しを止めても見失いは出る）', () => {
    const tips = new FlightTips();
    const allow = (t: string) => t !== 'overtake';
    const c = (o: number, off: number) => ({
      overtakes: o,
      fireOutOfRange: 0,
      offScreenSteps: off,
      engagedSteps: off,
    });
    expect(tips.update(0, c(0, 0), allow)).toBeNull();
    let got: string | null = null;
    for (let i = 1; i <= 300 && !got; i++)
      got = tips.update(i / 60, c(i === 250 ? 1 : i > 250 ? 1 : 0, i), allow);
    expect(got).toBe('lost');
  });

  it('見失った的の向き: 右・左・上・下と角度', () => {
    const out: TipDirection = { side: 'up', angleDeg: 0, arrowDeg: 0 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const from = { x: 0, y: 0, z: 0 };
    // 機首は -Z・上は +Y・右は +X
    expect(tipDirection(out, q, from, { x: 100, y: 0, z: 100 })?.side).toBe('right');
    expect(out.angleDeg).toBeCloseTo(135, 0);
    expect(tipDirection(out, q, from, { x: -100, y: 10, z: 0 })?.side).toBe('left');
    expect(tipDirection(out, q, from, { x: 0, y: 100, z: -10 })?.side).toBe('up');
    expect(tipDirection(out, q, from, { x: 5, y: -100, z: 50 })?.side).toBe('down');
    expect(tipDirection(out, q, from, from)).toBeNull();
  });
});

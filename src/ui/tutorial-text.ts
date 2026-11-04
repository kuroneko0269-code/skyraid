// チュートリアル（4-11）の文（src/data/i18n/*.json の tutorial）。DOM 非依存の純関数
import type { InputDevice } from '../core/input';
import { messageSubtree } from '../core/i18n';
import { ACTIONS, type Action } from '../data/keybinds';
import type { TutorialStep } from '../data/tutorial';
import type { SteerMode } from '../data/steer';

export type TutorialStrings = (typeof import('../data/i18n/ja.json'))['tutorial'];

/** 今の言語のチュートリアルの文（表の tutorial。ja / en のキーが同じことはテストで確かめる） */
export function tutorialStrings(): TutorialStrings {
  const tree = messageSubtree('tutorial');
  if (!tree) throw new Error('i18n: tutorial strings are not loaded');
  // 表の形は ja.json と同じ（tests/i18n.test.ts）
  return tree as unknown as TutorialStrings;
}

/** 指示の文の入力系統（キーボードは割当のキー名を埋め込む） */
const VARIANT: Record<InputDevice, 'touch' | 'keys' | 'pad'> = {
  touch: 'touch',
  keyboard: 'keys',
  gamepad: 'pad',
};

/** 方式ごとの文のキー（無ければ touch の文） */
const STEER_TEXT: Readonly<Partial<Record<SteerMode, string>>> = {
  classic: 'touchClassic',
  tilt: 'touchTilt',
  drag: 'touchDrag',
};

/**
 * 段階の指示。{pitchUp} のようなアクション名を keyName（今の割当のキーの表示名）で置き換える。
 * steer: タッチの操縦の方式（9-2 の classic は touchClassic、9-4 の tilt は touchTilt・drag は touchDrag の文がある段階だけ使う）。
 * autoFire: タッチの自動射撃が ON（9-3。touchAuto の文がある段階だけ使う）
 */
export function tutorialStepText(
  step: TutorialStep,
  device: InputDevice,
  keyName: (action: Action) => string,
  steer: SteerMode = 'direct',
  autoFire = false,
): string {
  const texts: Readonly<Record<string, string>> = tutorialStrings().steps[step];
  const variant = VARIANT[device];
  const touch = variant === 'touch';
  const text =
    (touch ? texts[STEER_TEXT[steer] ?? ''] : undefined) ??
    (touch && autoFire ? texts.touchAuto : undefined) ??
    texts[variant] ??
    '';
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) =>
    (ACTIONS as readonly string[]).includes(name) ? keyName(name as Action) : whole,
  );
}

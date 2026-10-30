// チュートリアル（4-11）の文（src/data/i18n/*.json の tutorial）。DOM 非依存の純関数
import type { InputDevice } from '../core/input';
import type { Locale } from '../core/locale';
import en from '../data/i18n/en.json';
import ja from '../data/i18n/ja.json';
import { ACTIONS, type Action } from '../data/keybinds';
import type { TutorialStep } from '../data/tutorial';

export type TutorialStrings = typeof ja.tutorial;

const STRINGS: Record<Locale, TutorialStrings> = { ja: ja.tutorial, en: en.tutorial };

export function tutorialStrings(locale: Locale): TutorialStrings {
  return STRINGS[locale];
}

/** 指示の文の入力系統（キーボードは割当のキー名を埋め込む） */
const VARIANT: Record<InputDevice, 'touch' | 'keys' | 'pad'> = {
  touch: 'touch',
  keyboard: 'keys',
  gamepad: 'pad',
};

/**
 * 段階の指示。{pitchUp} のようなアクション名を keyName（今の割当のキーの表示名）で置き換える
 */
export function tutorialStepText(
  step: TutorialStep,
  device: InputDevice,
  locale: Locale,
  keyName: (action: Action) => string,
): string {
  const text = STRINGS[locale].steps[step][VARIANT[device]];
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) =>
    (ACTIONS as readonly string[]).includes(name) ? keyName(name as Action) : whole,
  );
}

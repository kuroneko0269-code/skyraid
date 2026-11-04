// チュートリアル（4-11 → 9-5c で章に分けた）の文（src/data/i18n/*.json の tutorial）。DOM 非依存の純関数。
// 指示・ヒントは操作の方式（方向へ倒す・傾き・ドラッグ・ピッチとロール・キーボード・パッド）ごとに出し分ける
import type { InputDevice } from '../core/input';
import { messageSubtree, t } from '../core/i18n';
import { ACTIONS, type Action } from '../data/keybinds';
import type { SteerMode } from '../data/steer';
import type { TutorialChapter } from '../data/tutorial';

export type TutorialStrings = (typeof import('../data/i18n/ja.json'))['tutorial'];

/** 今の言語のチュートリアルの文（表の tutorial。ja / en のキーが同じことはテストで確かめる） */
export function tutorialStrings(): TutorialStrings {
  const tree = messageSubtree('tutorial');
  if (!tree) throw new Error('i18n: tutorial strings are not loaded');
  // 表の形は ja.json と同じ（tests/i18n.test.ts）
  return tree as unknown as TutorialStrings;
}

/** 文の出し分け（タッチは操縦の方式ごと） */
export const TUTORIAL_VARIANTS = ['direct', 'tilt', 'drag', 'classic', 'keys', 'pad'] as const;
export type TutorialVariant = (typeof TUTORIAL_VARIANTS)[number];

/** 入力系統とタッチの方式 → 文の出し分け */
export function tutorialVariant(device: InputDevice, steer: SteerMode): TutorialVariant {
  if (device === 'keyboard') return 'keys';
  if (device === 'gamepad') return 'pad';
  return steer;
}

const TOUCH: readonly TutorialVariant[] = ['direct', 'tilt', 'drag', 'classic'];

/**
 * 方式ごとの文の表（{ direct, tilt, ..., all }）から選ぶ: その方式 → タッチなら direct → all。
 * {pitchUp} のようなアクション名は keyName（今の割当のキーの表示名）で置き換える
 */
export function pickVariant(
  texts: Readonly<Record<string, string>> | undefined,
  variant: TutorialVariant,
  keyName: (action: Action) => string,
): string {
  if (!texts) return '';
  const text =
    texts[variant] ?? (TOUCH.includes(variant) ? texts.direct : undefined) ?? texts.all ?? '';
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) =>
    (ACTIONS as readonly string[]).includes(name) ? keyName(name as Action) : whole,
  );
}

type StepTexts = Readonly<Record<string, Readonly<Record<string, string>>>>;

function stepTexts(chapter: TutorialChapter, step: string): StepTexts | undefined {
  const c = tutorialStrings().chapters[chapter] as { steps?: Record<string, StepTexts> };
  return c.steps?.[step];
}

/** 段階の指示 */
export function tutorialStepText(
  chapter: TutorialChapter,
  step: string,
  variant: TutorialVariant,
  keyName: (action: Action) => string,
): string {
  return pickVariant(stepTexts(chapter, step)?.text, variant, keyName);
}

/** 段階のヒント（時間がたっても達成できないとき） */
export function tutorialStepHint(
  chapter: TutorialChapter,
  step: string,
  variant: TutorialVariant,
  keyName: (action: Action) => string,
): string {
  return pickVariant(stepTexts(chapter, step)?.hint, variant, keyName);
}

/** 飛行中の一言（追い越し・射程外・見失い・NEED SPEED・ミサイルの命中・的の出し直し） */
export function tutorialLiveHint(
  hint: string,
  variant: TutorialVariant,
  keyName: (action: Action) => string,
): string {
  const live = tutorialStrings().live as Readonly<Record<string, Readonly<Record<string, string>>>>;
  return pickVariant(live[hint], variant, keyName);
}

/** 章の名前と目当て */
export function tutorialChapterName(chapter: TutorialChapter): { name: string; goal: string } {
  const c = tutorialStrings().chapters[chapter];
  return { name: c.name, goal: c.goal };
}

/** 「第 3 章」 */
export function tutorialChapterNumber(index: number): string {
  return t('tutorial.list.chapter', { n: String(index + 1) });
}

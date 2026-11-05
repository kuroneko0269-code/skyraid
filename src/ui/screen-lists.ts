// 一覧の画面と戻り先（screens.ts が 300 行を超えたので分けた。9-9）
import type { ScreenState } from '../core/game-state';

/** Esc でモード選択へ戻る一覧の画面（9-9 で日替わり） */
export const LIST_SCREENS: readonly ScreenState[] = [
  'mission_select',
  'race_select',
  'replay_select',
  'practice_select',
  'daily_select',
];

/**
 * リザルト・ポーズの「中断」の戻り先: 日替わりは日替わりの画面（9-9。周回のレース・練習場の課題で飛ぶので先に見る）、
 * レースはコース一覧、練習場は課題の一覧、チュートリアル・レイド・防衛戦はモード選択、ほかはミッション一覧
 */
export function listStateOf(s: {
  inDaily(): boolean;
  inRace(): boolean;
  inPractice(): boolean;
  inDefense(): boolean;
  readonly inTutorial: boolean;
  readonly inRaid: boolean;
}): ScreenState {
  if (s.inDaily()) return 'daily_select';
  if (s.inRace()) return 'race_select';
  if (s.inPractice()) return 'practice_select';
  if (s.inDefense()) return 'mode_select';
  return s.inTutorial || s.inRaid ? 'mode_select' : 'mission_select';
}

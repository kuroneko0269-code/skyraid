// チュートリアル（4-11 → 9-5c で章に分けた）の進み具合をセーブに記録する（Three.js・DOM 非依存）: 章を終えたらその章を
// records.tutorial に足し、飛ぶ章をすべて終えた初めてのときだけ TUTORIAL_CONFIG.rewardCredits を足して印 tutorialDone を立てる
// （4-11 と同じ決まり: 報酬は初回だけ。9-5c より前に完了した人は印があるので、章を終えても報酬はない）
import type { EventBus } from '../core/event-bus';
import { TUTORIAL_CONFIG, TUTORIAL_FLIGHT_CHAPTERS, type TutorialChapter } from '../data/tutorial';
import type { MissionEvents } from '../missions/events';
import type { SaveStore } from './save-store';

export interface TutorialReward {
  /** この章で足したクレジット（リザルトの「獲得」。未完了・2 回目以降は 0） */
  readonly paid: number;
  off(): void;
}

/** 終えた章 */
export function tutorialChaptersDone(save: SaveStore): ReadonlySet<TutorialChapter> {
  return new Set(save.snapshot.records.tutorial);
}

/** 章を終えた印を付ける。飛ぶ章がすべてそろった初めてのときだけ報酬を足して、その額を返す */
export function completeTutorialChapter(save: SaveStore, chapter: TutorialChapter): number {
  save.transact((data) => {
    if (data.records.tutorial.includes(chapter)) return false;
    data.records.tutorial.push(chapter);
    return true;
  });
  const done = tutorialChaptersDone(save);
  if (save.flag('tutorialDone') || !TUTORIAL_FLIGHT_CHAPTERS.every((c) => done.has(c))) return 0;
  save.addCredits(TUTORIAL_CONFIG.rewardCredits);
  save.setFlag('tutorialDone');
  return TUTORIAL_CONFIG.rewardCredits;
}

export function bindTutorialReward(
  bus: EventBus<MissionEvents>,
  save: SaveStore,
  chapter: TutorialChapter,
): TutorialReward {
  let paid = 0;
  const off = bus.on('mission:end', ({ result }) => {
    if (result.outcome !== 'success') return;
    paid = completeTutorialChapter(save, chapter);
  });
  return {
    get paid() {
      return paid;
    },
    off,
  };
}

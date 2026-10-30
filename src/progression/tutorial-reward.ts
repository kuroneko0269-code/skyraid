// チュートリアル（4-11）の完了をセーブに記録する（Three.js・DOM 非依存）: 初めて完了したときだけ
// TUTORIAL_CONFIG.rewardCredits を足し、印 tutorialDone を立てる。2 回目からは報酬なし（何度でも練習できる）
import type { EventBus } from '../core/event-bus';
import { TUTORIAL_CONFIG } from '../data/tutorial';
import type { MissionEvents } from '../missions/events';
import type { SaveStore } from './save-store';

export interface TutorialReward {
  /** このチュートリアルで足したクレジット（リザルトの「獲得」。未完了・2 回目以降は 0） */
  readonly paid: number;
  off(): void;
}

export function bindTutorialReward(bus: EventBus<MissionEvents>, save: SaveStore): TutorialReward {
  let paid = 0;
  const off = bus.on('mission:end', ({ result }) => {
    if (result.outcome !== 'success') return;
    if (!save.flag('tutorialDone')) {
      save.addCredits(TUTORIAL_CONFIG.rewardCredits);
      paid = TUTORIAL_CONFIG.rewardCredits;
    }
    save.setFlag('tutorialDone');
  });
  return {
    get paid() {
      return paid;
    },
    off,
  };
}

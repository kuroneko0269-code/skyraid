// ミッションの結果をセーブに反映する（3-2、Three.js・DOM 非依存）: ランナーのイベント（2-4）を購読し、
// 成功（mission:end）でランクと解放を、報酬（mission:reward）でクレジットを記録する。どちらも受けたときに保存する
import type { EventBus } from '../core/event-bus';
import type { MissionEvents } from '../missions/events';
import type { CampaignProgress } from './campaign-progress';
import type { SaveStore } from './save-store';

/** ランナーのバスを購読する。戻り値で購読解除 */
export function bindMissionRewards(
  bus: EventBus<MissionEvents>,
  save: SaveStore,
  progress: CampaignProgress,
): () => void {
  const offEnd = bus.on('mission:end', ({ result }) => {
    if (result.outcome === 'success' && result.rank)
      progress.recordClear(result.missionId, result.rank);
  });
  const offReward = bus.on('mission:reward', ({ credits }) => {
    if (credits > 0) save.addCredits(credits);
  });
  return () => {
    offEnd();
    offReward();
  };
}

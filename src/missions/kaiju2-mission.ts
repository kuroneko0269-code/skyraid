// 9-6b: ネフィルガのソロのレイドのミッション（?dev=kaiju2 の裏だけ。遅延チャンクがレイドの別の怪獣として登録する）。
// 港湾都市・開始位置・報酬の式（2,000 CR × 時間ボーナス × 高難度 1.8・失敗 300）はヴォルガスと同じ。出現物は無く、
// 怪獣は差し込み口（missions/kaiju2-dev.ts）が出す。失敗は嵐が街に着く（制限時間）・戦域離脱
import { RAID_CONFIG } from '../data/kaiju';
import { k2list, k2t } from '../data/kaiju2-text';
import { RAID_RULES, type RaidDifficulty } from '../data/raid';
import type { RaidVariant } from './raid-variants';
import type { MissionDef } from './types';

export const NEPHIRGA_ID = 'nephirga';
export const NEPHIRGA_MISSION_ID = 'raidNephirga';

export function nephirgaRaidMission(difficulty: RaidDifficulty = 'normal'): MissionDef {
  return {
    id: NEPHIRGA_MISSION_ID,
    mapId: RAID_CONFIG.mapId,
    start: RAID_CONFIG.start,
    parTimeSeconds: RAID_CONFIG.parTimeSeconds,
    spawns: [],
    objectives: [
      {
        id: 'kaiju',
        type: 'kaiju',
        required: true,
        start: 'withPrevious',
        damageRatio: 1,
        get label() {
          return k2t('objective');
        },
      },
    ],
    success: 'allRequiredObjectives',
    failConditions: ['kaijuReachedCity', 'outOfBounds'],
    reward: { baseCredits: RAID_RULES.reward.soloBase, raid: { difficulty, kaiju: NEPHIRGA_ID } },
  };
}

export const NEPHIRGA_VARIANT: RaidVariant = {
  id: NEPHIRGA_ID,
  missionId: NEPHIRGA_MISSION_ID,
  label: () => k2t('dialogLabel'),
  mission: nephirgaRaidMission,
  title: (d) => k2t(d === 'hard' ? 'titleHard' : 'titleNormal'),
  strings: () => ({ title: k2t('missionTitle'), briefing: k2list('briefing') }),
};

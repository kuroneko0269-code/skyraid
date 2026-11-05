// 9-6b: ネフィルガのソロのレイドのミッション。9-6c: 一般に公開（起動時に登録する。判定・形・HUD・音は遅延チャンクで、
// ミッションを始める前・再生の前に読む: src/ui/kaiju2-link.ts）。起動時に読むので、ここは名前と数値の参照だけにする。
// 港湾都市・開始位置・報酬の式（2,000 CR × 時間ボーナス × 高難度 1.8・失敗 300）はヴォルガスと同じ。出現物は無く、
// 怪獣は差し込み口（missions/kaiju2-dev.ts）が出す。失敗は嵐の時間切れ・全体の時間切れ（9-6c で理由を分けた）・戦域離脱
import { t } from '../core/i18n';
import { RAID_CONFIG } from '../data/kaiju';
import { RAID_RULES, type RaidDifficulty } from '../data/raid';
import { NEPHIRGA_ID } from '../data/raid-kaiju';
import type { RaidVariant } from './raid-variants';
import type { MissionDef } from './types';

export { NEPHIRGA_ID } from '../data/raid-kaiju';
export const NEPHIRGA_MISSION_ID = 'raidNephirga';

/** ブリーフィングの文（遅延チャンクの文言の表にある。読み込むまでは空。kaiju2-link.ts が読んだときに差す） */
let briefingLines: () => readonly string[] = () => [];

export function setNephirgaBriefing(fn: () => readonly string[]): void {
  briefingLines = fn;
}

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
          return t('kaiju2.objective');
        },
      },
    ],
    success: 'allRequiredObjectives',
    failConditions: ['stormTimeUp', 'totalTimeUp', 'outOfBounds', 'livesOut'],
    lives: RAID_RULES.lives[difficulty],
    reward: { baseCredits: RAID_RULES.reward.soloBase, raid: { difficulty, kaiju: NEPHIRGA_ID } },
  };
}

export const NEPHIRGA_VARIANT: RaidVariant = {
  id: NEPHIRGA_ID,
  missionId: NEPHIRGA_MISSION_ID,
  label: () => t('kaiju2.name'),
  mission: nephirgaRaidMission,
  title: (d) => t(d === 'hard' ? 'kaiju2.titleHard' : 'kaiju2.titleNormal'),
  strings: () => ({ title: t('kaiju2.missionTitle'), briefing: briefingLines() }),
};

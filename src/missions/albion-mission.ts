// 10-3b: 白鯨アルビオンのソロのレイドのミッション（起動時に登録する。判定・形・HUD は遅延チャンクで、ミッションを始める前・
// 再生の前に読む: src/ui/albion-link.ts）。起動時に読むので、ここは名前と数値の参照だけにする。
// 港湾都市・開始位置・報酬の式はヴォルガス・ネフィルガと同じ。出現物は無く、怪獣は差し込み口（missions/albion-dev.ts）が出す。
// 失敗は時間切れ（湾を渡り切って去る）・戦域離脱・残機切れ
import { t } from '../core/i18n';
import { RAID_CONFIG } from '../data/kaiju';
import { RAID_RULES, type RaidDifficulty } from '../data/raid';
import type { RaidVariant } from './raid-variants';
import type { MissionDef } from './types';

export const ALBION_ID = 'albion';
export const ALBION_MISSION_ID = 'raidAlbion';

/** ブリーフィングの文（遅延チャンクの文言の表にある。読み込むまでは空。読んだときに差す） */
let briefingLines: () => readonly string[] = () => [];

export function setAlbionBriefing(fn: () => readonly string[]): void {
  briefingLines = fn;
}

export function albionRaidMission(difficulty: RaidDifficulty = 'normal'): MissionDef {
  return {
    id: ALBION_MISSION_ID,
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
          return t('albion.objective');
        },
      },
    ],
    success: 'allRequiredObjectives',
    failConditions: ['totalTimeUp', 'outOfBounds', 'livesOut'],
    lives: RAID_RULES.lives[difficulty],
    reward: { baseCredits: RAID_RULES.reward.soloBase, raid: { difficulty, kaiju: ALBION_ID } },
  };
}

export const ALBION_VARIANT: RaidVariant = {
  id: ALBION_ID,
  missionId: ALBION_MISSION_ID,
  label: () => t('albion.name'),
  mission: albionRaidMission,
  title: (d) => t(d === 'hard' ? 'albion.titleHard' : 'albion.titleNormal'),
  strings: () => ({ title: t('albion.missionTitle'), briefing: briefingLines() }),
};

// 10-5b: UFO ゼノリスのソロのレイドのミッション（起動時に登録する。判定・形・HUD は遅延チャンクで、ミッションを始める前・
// 再生の前に読む: src/ui/xenolith-link.ts）。起動時に読むので、ここは名前と数値の参照だけにする。
// 港湾都市・開始位置・報酬の式はヴォルガス・ネフィルガと同じ。出現物は無く、怪獣は差し込み口（missions/xenolith-dev.ts）が出す。
// 失敗は時間切れ（空へ去る）・戦域離脱・残機切れ
import { t } from '../core/i18n';
import { RAID_CONFIG } from '../data/kaiju';
import { RAID_RULES, type RaidDifficulty } from '../data/raid';
import type { RaidVariant } from './raid-variants';
import type { MissionDef } from './types';

export const XENOLITH_ID = 'xenolith';
export const XENOLITH_MISSION_ID = 'raidXenolith';

/** ブリーフィングの文（遅延チャンクの文言の表にある。読み込むまでは空。読んだときに差す） */
let briefingLines: () => readonly string[] = () => [];

export function setXenolithBriefing(fn: () => readonly string[]): void {
  briefingLines = fn;
}

export function xenolithRaidMission(difficulty: RaidDifficulty = 'normal'): MissionDef {
  return {
    id: XENOLITH_MISSION_ID,
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
          return t('xenolith.objective');
        },
      },
    ],
    success: 'allRequiredObjectives',
    failConditions: ['totalTimeUp', 'outOfBounds', 'livesOut'],
    lives: RAID_RULES.lives[difficulty],
    reward: { baseCredits: RAID_RULES.reward.soloBase, raid: { difficulty, kaiju: XENOLITH_ID } },
  };
}

export const XENOLITH_VARIANT: RaidVariant = {
  id: XENOLITH_ID,
  missionId: XENOLITH_MISSION_ID,
  label: () => t('xenolith.name'),
  mission: xenolithRaidMission,
  title: (d) => t(d === 'hard' ? 'xenolith.titleHard' : 'xenolith.titleNormal'),
  strings: () => ({ title: t('xenolith.missionTitle'), briefing: briefingLines() }),
};

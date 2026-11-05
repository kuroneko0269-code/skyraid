// キャンペーンの M6〜M8（9-7。M5 の後に続き、少しずつ難しくなる。データだけ、ロジックなし）。一覧（MISSIONS）は src/data/missions.ts。
// タイトル・ブリーフィング文は src/data/i18n/*.json の missions[id]、天候は src/data/weather.ts の MISSION_WEATHER。
// 距離は m、時間は秒、北は -Z、向きは -Z から右回り。数値は tests/campaign-bots.ts のボットで決めた（docs/decisions.md の 9-7）
import { t } from '../core/i18n';
import type { EnemyFighterSpawn, MissionDef, Pose } from '../missions/types';
import { CAMPAIGN_MISSILE_RESUPPLY_SECONDS } from './campaign-rules';
import { RAID_CONFIG } from './kaiju';
import { NEPHIRGA_ID } from './raid-kaiju';

/** 島の周りを回る四角い経路（M2 の ISLAND_PATROL と同じ。missions.ts から読むと循環するので写す） */
const ISLAND_PATROL = [
  { x: -2000, y: 1000, z: -2000 },
  { x: 2000, y: 1100, z: -2000 },
  { x: 2000, y: 1000, z: 2000 },
  { x: -2000, y: 900, z: 2000 },
] as const;

/** 波の目標の表示名（「第 1 波」） */
function waveLabel(n: number): { readonly label: string } {
  return {
    get label() {
      return t('objectives.wave', { n });
    },
  };
}

/** M6: 波の間隔・同じ波の 2 機目が遅れて来る秒数（秒）と、敵機の HP の倍率（M2 と同じ） */
const M6_WAVE_SECONDS = 75;
const M6_PAIR_SECONDS = 30;
const M6_HP_SCALE = 0.6;

/** M6 の敵機 1 機（easy。島の周りを回る） */
function nightFighter(wave: number, seconds: number, at: Pose): EnemyFighterSpawn {
  return {
    kind: 'enemyFighter',
    group: `night-wave${String(wave)}`,
    count: 1,
    difficulty: 'easy',
    hpScale: M6_HP_SCALE,
    trigger: seconds > 0 ? { type: 'time', seconds } : { type: 'start' },
    positions: [at],
    patrol: ISLAND_PATROL,
  };
}

/**
 * M6 夜間迎撃: 夜（月と星）の島に、敵の戦闘機 6 機（easy・HP ×0.6）が 3 波で来る（北 → 東 → 西。0 / 75 / 150 秒、同じ波の 2 機目は
 * 30 秒遅れ。波の目標は始めから 3 つとも数える）。夜は敵の印が索敵距離の 60% まで（7-5）なので、レーダーを頼りに探す。
 * 波を時間で出すので、速く落としても次の波を待つ（短くなりすぎない）
 */
export const NIGHT_INTERCEPT_MISSION: MissionDef = {
  id: 'night-intercept',
  mapId: 'island',
  start: { x: 0, y: 700, z: 4500, headingDeg: 0 },
  timeLimitSeconds: 540,
  parTimeSeconds: 270,
  missileResupplySeconds: CAMPAIGN_MISSILE_RESUPPLY_SECONDS,
  spawns: [
    nightFighter(1, 0, { x: -1200, y: 1300, z: -5000, headingDeg: 170 }),
    nightFighter(1, M6_PAIR_SECONDS, { x: 1200, y: 1400, z: -5200, headingDeg: 190 }),
    nightFighter(2, M6_WAVE_SECONDS, { x: 5000, y: 1200, z: -800, headingDeg: 260 }),
    nightFighter(2, M6_WAVE_SECONDS + M6_PAIR_SECONDS, {
      x: 5200,
      y: 1300,
      z: 600,
      headingDeg: 280,
    }),
    nightFighter(3, M6_WAVE_SECONDS * 2, { x: -5000, y: 1300, z: 400, headingDeg: 90 }),
    nightFighter(3, M6_WAVE_SECONDS * 2 + M6_PAIR_SECONDS, {
      x: -5200,
      y: 1400,
      z: -900,
      headingDeg: 80,
    }),
  ],
  objectives: [
    {
      id: 'wave1',
      type: 'kill',
      required: true,
      start: 'withPrevious',
      target: 'enemyFighter',
      group: 'night-wave1',
      count: 2,
      ...waveLabel(1),
    },
    {
      id: 'wave2',
      type: 'kill',
      required: true,
      start: 'withPrevious',
      target: 'enemyFighter',
      group: 'night-wave2',
      count: 2,
      ...waveLabel(2),
    },
    {
      id: 'wave3',
      type: 'kill',
      required: true,
      start: 'withPrevious',
      target: 'enemyFighter',
      group: 'night-wave3',
      count: 2,
      ...waveLabel(3),
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 3500 },
};

/**
 * M7 対空陣地: 霧の早朝、港湾都市（6-4）の北の丘の拠点を叩く。施設 4 つ（レーダー・燃料タンク 2・格納庫）が必須、
 * 守りの対空砲 4 門（easy。M4 の対空砲は normal 1 門）の破壊は任意。湾の沖から北へ向かって始まる。街（タワー群）の上は 900m で越える
 */
export const FLAK_LINE_MISSION: MissionDef = {
  id: 'flak-line',
  mapId: 'harbor',
  start: { x: 0, y: 900, z: 4300, headingDeg: 0 },
  // 機銃で 8 か所を回ると初心者役のボットで 3〜7.5 分かかる（人はさらに長い）ので、制限は長めに
  timeLimitSeconds: 600,
  parTimeSeconds: 270,
  missileResupplySeconds: CAMPAIGN_MISSILE_RESUPPLY_SECONDS,
  spawns: [
    {
      kind: 'groundTarget',
      group: 'flak-depots',
      targetType: 'radar',
      trigger: { type: 'start' },
      positions: [{ x: -1900, z: -1500 }],
    },
    {
      kind: 'groundTarget',
      group: 'flak-depots',
      targetType: 'fuelTank',
      trigger: { type: 'start' },
      positions: [
        { x: 1800, z: -400 },
        { x: -2300, z: 600 },
      ],
    },
    {
      kind: 'groundTarget',
      group: 'flak-depots',
      targetType: 'hangar',
      trigger: { type: 'start' },
      positions: [{ x: 900, z: -1500 }],
    },
    {
      kind: 'groundTarget',
      group: 'flak-guns',
      targetType: 'aaa',
      trigger: { type: 'start' },
      positions: [
        { x: -300, z: -1700 },
        { x: -1000, z: -800 },
        { x: 2300, z: -1500 },
        { x: -2600, z: -700 },
      ],
      difficulty: 'easy',
    },
  ],
  objectives: [
    {
      id: 'depots',
      type: 'destroy',
      required: true,
      start: 'withPrevious',
      group: 'flak-depots',
      count: 4,
    },
    {
      id: 'guns',
      type: 'destroy',
      required: false,
      start: 'withPrevious',
      group: 'flak-guns',
      count: 4,
      get label() {
        return t('objectives.aaaGuns');
      },
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 4000 },
};

/**
 * M8 決戦: 港湾都市の空でネフィルガ（9-6）と戦う。キャンペーン版（数値は KAIJU2_RAID_CONFIG.campaign。登場・段階の変わり目・撃破の
 * 演出は src/ui/kaiju2-finale.ts）。残機なし（撃墜で失敗）・制限時間 10 分。開始位置はレイドと同じ街の北、湾側を向く
 */
export const FINALE_MISSION: MissionDef = {
  id: 'finale',
  mapId: RAID_CONFIG.mapId,
  start: RAID_CONFIG.start,
  timeLimitSeconds: 600,
  parTimeSeconds: 300,
  missileResupplySeconds: CAMPAIGN_MISSILE_RESUPPLY_SECONDS,
  skyKaiju: NEPHIRGA_ID,
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
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 5000 },
};

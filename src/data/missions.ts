// ミッションの定義（2-4、2-5 で 5 本。データだけ、ロジックなし）。型は src/missions/types.ts、進め方は src/missions/runner.ts。
// ミッションを増やすときは MISSIONS に足すだけ。タイトル・ブリーフィング文は src/data/i18n/*.json の missions[id]。
// 距離は m、時間は秒。島の中心が原点、海岸線は半径 約 2.6〜3.2km、北は -Z。向き（headingDeg）は -Z から右回り（東 = 90）
import type { MissionDef } from '../missions/types';
import { ENCOUNTER_MISSION, ESCORT_MISSION, STRIKE_MISSION } from './missions-special';
import { DEFAULT_RANK_MULTIPLIERS } from './ranking';

/** ミッションの流れの時間 */
export const MISSION_FLOW = {
  /** 目標達成・成功・失敗の大きな文字を画面中央に出す時間 */
  bannerSeconds: 2,
  /** 成功・失敗が決まってからリザルト画面に移るまで（大きな文字を出し終えてから） */
  resultDelaySeconds: 2,
} as const;

/**
 * M1 訓練: 島の周りのリング 10 個を順に通り、そのあと敵機 2 機（rookie。4-12 で easy から）を撃墜する（2-4 の仮ミッションをそのまま M1 にした）。
 * - リング: 1 個目は開始位置の 1.2km 先（機首の正面）。2〜10 個目は島の中心から半径 3700m の円上に 37.5° おき
 *   （間隔 約 2.4km = 巡航で約 10 秒）、高度 450〜750m。向きは円の接線（南 → 東 → 北 → 西と回る）。一周 約 100 秒
 * - 敵機: リングをすべて通ると（撃墜の目標が始まると）、島の上空に南向きで出て、島の周りを回る（巡航の経路はフリーフライトと同じ）
 * - 基準時間 240 秒（リング 約 100 秒 + 空戦 約 140 秒）、制限時間 480 秒
 */
export const TRAINING_MISSION: MissionDef = {
  id: 'training',
  mapId: 'island',
  start: { x: 0, y: 500, z: 4500, headingDeg: 0 },
  timeLimitSeconds: 480,
  parTimeSeconds: 240,
  spawns: [
    {
      kind: 'enemyFighter',
      group: 'training-bandits',
      count: 2,
      difficulty: 'rookie',
      trigger: { type: 'objectiveActive', objective: 'bandits' },
      positions: [
        { x: -800, y: 1000, z: -600, headingDeg: 200 },
        { x: 800, y: 1100, z: -900, headingDeg: 160 },
      ],
      patrol: [
        { x: -2000, y: 1000, z: -2000 },
        { x: 2000, y: 1100, z: -2000 },
        { x: 2000, y: 1000, z: 2000 },
        { x: -2000, y: 900, z: 2000 },
      ],
    },
  ],
  objectives: [
    {
      id: 'rings',
      type: 'rings',
      required: true,
      start: 'withPrevious',
      rings: [
        { x: 0, y: 500, z: 3300, headingDeg: 0 },
        { x: 1850, y: 550, z: 3204, headingDeg: 60 },
        { x: 3418, y: 650, z: 1416, headingDeg: 22.5 },
        { x: 3574, y: 750, z: -958, headingDeg: 345 },
        { x: 2252, y: 700, z: -2935, headingDeg: 307.5 },
        { x: 0, y: 600, z: -3700, headingDeg: 270 },
        { x: -2252, y: 500, z: -2935, headingDeg: 232.5 },
        { x: -3574, y: 450, z: -958, headingDeg: 195 },
        { x: -3418, y: 550, z: 1416, headingDeg: 157.5 },
        { x: -1850, y: 600, z: 3204, headingDeg: 120 },
      ],
    },
    {
      id: 'bandits',
      type: 'kill',
      required: true,
      start: 'afterPrevious',
      target: 'enemyFighter',
      group: 'training-bandits',
      count: 2,
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 1000, rankMultipliers: DEFAULT_RANK_MULTIPLIERS },
};

/** 島の周りを回る四角い経路（フリーフライトの敵機と同じ） */
export const ISLAND_PATROL = [
  { x: -2000, y: 1000, z: -2000 },
  { x: 2000, y: 1100, z: -2000 },
  { x: 2000, y: 1000, z: 2000 },
  { x: -2000, y: 900, z: 2000 },
] as const;

/**
 * M2 初陣: 敵機 3 機を撃墜する。1 機ずつ 20 秒差で来る: 開始時に北西（easy。4-7 の事前修正）、20 秒後に北東、40 秒後に北西（normal。2-6 の事前修正。
 * それまでは開始時に 2 機同時）。
 * 開始位置は起動位置と同じ島の南の沖合
 */
export const FIRST_SORTIE_MISSION: MissionDef = {
  id: 'first-sortie',
  mapId: 'island',
  start: { x: 0, y: 500, z: 4500, headingDeg: 0 },
  timeLimitSeconds: 420,
  parTimeSeconds: 210,
  spawns: [
    {
      kind: 'enemyFighter',
      group: 'first-sortie-bandits',
      count: 1,
      difficulty: 'easy',
      trigger: { type: 'start' },
      positions: [{ x: -3000, y: 1100, z: -2500, headingDeg: 120 }],
      patrol: ISLAND_PATROL,
    },
    {
      kind: 'enemyFighter',
      group: 'first-sortie-bandits',
      count: 1,
      difficulty: 'normal',
      trigger: { type: 'time', seconds: 20 },
      positions: [{ x: 3000, y: 1200, z: -3000, headingDeg: 240 }],
      patrol: ISLAND_PATROL,
    },
    {
      kind: 'enemyFighter',
      group: 'first-sortie-bandits',
      count: 1,
      difficulty: 'normal',
      trigger: { type: 'time', seconds: 40 },
      positions: [{ x: -3200, y: 1200, z: -2200, headingDeg: 120 }],
      patrol: ISLAND_PATROL,
    },
  ],
  objectives: [
    {
      id: 'bandits',
      type: 'kill',
      required: true,
      start: 'withPrevious',
      target: 'enemyFighter',
      group: 'first-sortie-bandits',
      count: 3,
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 1500 },
};

export {
  ENCOUNTER_MISSION,
  ESCORT_MISSION,
  ESCORT_ROUTE,
  KAIJU_ROUTE,
  STRIKE_MISSION,
} from './missions-special';

/** キャンペーンのミッション一覧（並び順のとおりに表示し、前を成功すると次が解放される） */
export const MISSIONS: readonly MissionDef[] = [
  TRAINING_MISSION,
  FIRST_SORTIE_MISSION,
  ESCORT_MISSION,
  STRIKE_MISSION,
  ENCOUNTER_MISSION,
];

// ミッションの定義（2-4。データだけ、ロジックなし）。型は src/missions/types.ts、進め方は src/missions/runner.ts。
// 2-5 でミッションを増やすときは MISSIONS に足すだけ。距離は m、時間は秒
import type { MissionDef } from '../missions/types';
import { DEFAULT_RANK_MULTIPLIERS } from './ranking';

/** ミッションの流れの時間 */
export const MISSION_FLOW = {
  /** 目標達成・成功・失敗の大きな文字を画面中央に出す時間 */
  bannerSeconds: 2,
  /** 成功・失敗が決まってからリザルト画面に移るまで（大きな文字を出し終えてから） */
  resultDelaySeconds: 2,
} as const;

/**
 * 訓練: 島の周りのリング 10 個を順に通り、そのあと敵機 2 機（easy）を撃墜する。
 * - リング: 1 個目は開始位置の 1.2km 先（機首の正面）。2〜10 個目は島の中心から半径 3700m の円上に 37.5° おき
 *   （間隔 約 2.4km = 巡航で約 10 秒）、高度 450〜750m。向きは円の接線（南 → 東 → 北 → 西と回る）。一周 約 100 秒
 * - 敵機: リングをすべて通ると（撃墜の目標が始まると）、島の上空に南向きで出て、島の周りを回る（巡航の経路はフリーフライトと同じ）
 * - 基準時間 240 秒（リング 約 100 秒 + 空戦 約 140 秒）、制限時間 480 秒
 */
export const TRAINING_MISSION: MissionDef = {
  id: 'training',
  title: '訓練',
  briefing:
    '島の周りに訓練用のリングを 10 個置いた。黄色く光るリングを順番にくぐれ。\n' +
    'すべて通ったら、仮想敵の戦闘機 2 機が島の上空に現れる。ロックオンとミサイル・機銃で撃墜せよ。\n' +
    '戦域（島の中心から 6km）の外へ出ないこと。',
  mapId: 'island',
  start: { x: 0, y: 500, z: 4500, headingDeg: 0 },
  timeLimitSeconds: 480,
  parTimeSeconds: 240,
  spawns: [
    {
      kind: 'enemyFighter',
      group: 'training-bandits',
      count: 2,
      difficulty: 'easy',
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

/** キャンペーンのミッション一覧（並び順のとおりに表示する） */
export const MISSIONS: readonly MissionDef[] = [TRAINING_MISSION];

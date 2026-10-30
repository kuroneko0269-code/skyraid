// チュートリアル（4-11）の定義。ミッションランナーで進める練習のミッション（失敗しない）と、段階ごとに光らせるタッチの部品。
// 指示の文は src/data/i18n/*.json の tutorial。距離は m、北は -Z、向きは -Z から右回り。島の山（最高 約 600m）より上の 900m を飛ぶ
import type { MissionDef } from '../missions/types';
import { ISLAND_PATROL } from './missions';

/** 光らせられるタッチ操作の部品（src/ui/touch-controls.ts） */
export const TOUCH_PARTS = ['stick', 'yaw', 'throttle', 'ab', 'msl', 'flr', 'gun'] as const;
export type TouchPart = (typeof TOUCH_PARTS)[number];

/** 段階（目標の id）。この順に進む */
export const TUTORIAL_STEPS = ['rings', 'speed', 'targets', 'drone', 'bandit'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

export const TUTORIAL_CONFIG = {
  /** 初めて完了したときだけもらえるクレジット */
  rewardCredits: 500,
  /** 段階ごとに光らせるタッチの部品 */
  highlights: {
    rings: ['stick'],
    speed: ['throttle', 'ab'],
    targets: ['gun'],
    drone: ['msl'],
    bandit: ['gun', 'msl', 'flr'],
  } satisfies Readonly<Record<TutorialStep, readonly TouchPart[]>>,
  /**
   * タッチ操作のヒント（フリーフライト・ミッションの初回）: 指す HUD の要素（CSS セレクタ）を順に、1 つ hintSeconds 秒。
   * 文は i18n の tutorial.hints[id]。飛行が始まって hintDelaySeconds 秒後から
   */
  hints: [
    { id: 'speed', selector: '.hud-left .hud-box' },
    { id: 'altitude', selector: '.hud-right .hud-box' },
    { id: 'radar', selector: '.hud-radar' },
    { id: 'ammo', selector: '.hud-ammo' },
  ],
  hintSeconds: 3,
  hintDelaySeconds: 1,
} as const;

/**
 * チュートリアル: 島の北の沖から南へ向かい、①リング 3 個（直進・左旋回・右旋回）→ ②アフターバーナーで 360 m/s
 * （スロットル最大の 330 では届かない）→ ③的（風船）2 個（data/targets.ts の先頭 2 地点。②を終えるあたりの南岸）→
 * ④ドローン 1 機（data/targets.ts の 1 本目の軌道）→ ⑤敵機 1 機（rookie）。
 * 失敗条件なし・制限時間なし・練習（撃墜されない、墜落は上空へ戻す）。報酬は初回だけ（progression/tutorial.ts）なのでここは 0
 */
export const TUTORIAL_MISSION: MissionDef = {
  id: 'tutorial',
  mapId: 'island',
  start: { x: 0, y: 900, z: -3600, headingDeg: 180 },
  parTimeSeconds: 240,
  practice: true,
  spawns: [
    { kind: 'targets', count: 2, trigger: { type: 'objectiveActive', objective: 'targets' } },
    { kind: 'drones', count: 1, trigger: { type: 'objectiveActive', objective: 'drone' } },
    {
      kind: 'enemyFighter',
      group: 'tutorial-bandit',
      count: 1,
      difficulty: 'rookie',
      trigger: { type: 'objectiveActive', objective: 'bandit' },
      positions: [{ x: -1800, y: 1000, z: 600, headingDeg: 90 }],
      patrol: ISLAND_PATROL,
    },
  ],
  objectives: [
    {
      id: 'rings',
      type: 'rings',
      required: true,
      start: 'withPrevious',
      rings: [
        { x: 0, y: 900, z: -2500, headingDeg: 180 },
        { x: 900, y: 900, z: -1600, headingDeg: 135 },
        { x: 900, y: 900, z: -300, headingDeg: 180 },
      ],
    },
    { id: 'speed', type: 'speed', required: true, start: 'afterPrevious', speed: 360 },
    {
      id: 'targets',
      type: 'kill',
      required: true,
      start: 'afterPrevious',
      target: 'target',
      count: 2,
    },
    {
      id: 'drone',
      type: 'kill',
      required: true,
      start: 'afterPrevious',
      target: 'drone',
      count: 1,
    },
    {
      id: 'bandit',
      type: 'kill',
      required: true,
      start: 'afterPrevious',
      target: 'enemyFighter',
      group: 'tutorial-bandit',
      count: 1,
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: [],
  reward: { baseCredits: 0 },
};

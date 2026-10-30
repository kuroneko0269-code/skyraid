// 護衛・破壊・怪獣の目標を使うミッション（2-5 の M3〜M5。データだけ、ロジックなし）。一覧（MISSIONS）は src/data/missions.ts。
// タイトル・ブリーフィング文は src/data/i18n/*.json の missions[id]。距離は m、時間は秒、北は -Z、向きは -Z から右回り
import type { MissionDef } from '../missions/types';

/** M3 の輸送機の経路（東岸の沖 → 西岸）。高度 800m は経路の真下の地表（最高 約 450m）より 300m 以上上 */
export const ESCORT_ROUTE = {
  from: { x: 4300, y: 800, z: -600 },
  to: { x: -3600, y: 800, z: -600 },
  /** 着いたとみなす水平の円（西岸の海岸線 x ≈ −2700 の少し沖） */
  destination: { x: -3000, z: -600, radius: 300 },
} as const;

/**
 * M3 護衛: 輸送機 1 機（120 m/s、HP 300）を島の東岸の沖から西岸まで送り届ける（約 7km・約 58 秒）。
 * 敵機 4 機（normal、輸送機を優先して狙う）が 2 波で来る: 開始時に西北西の沖から 2 機、30 秒後に北の沖から 2 機。
 * 敵機は近づいたプレイヤー機には向かってくる（src/data/ai.ts の ESCORT_ATTACK_CONFIG）ので、割って入って引きはがす。
 * 輸送機の HP 0 で失敗。敵機の撃墜は任意。自機は輸送機の 1.5km 前（西）から、敵の来る方を向いて始める
 */
export const ESCORT_MISSION: MissionDef = {
  id: 'escort',
  mapId: 'island',
  start: { x: 2800, y: 1000, z: -600, headingDeg: 270 },
  // 輸送機が着くまでの時間（約 58 秒）は縮められないので制限時間なし。基準時間はそれより長くし、評価は被弾だけで決まる
  parTimeSeconds: 75,
  spawns: [
    {
      kind: 'transport',
      group: 'convoy',
      trigger: { type: 'start' },
      from: ESCORT_ROUTE.from,
      to: ESCORT_ROUTE.to,
    },
    {
      kind: 'enemyFighter',
      group: 'escort-bandits',
      count: 2,
      difficulty: 'normal',
      trigger: { type: 'start' },
      attack: 'transport',
      positions: [
        { x: -4800, y: 1200, z: -2600, headingDeg: 100 },
        { x: -4600, y: 1300, z: -3300, headingDeg: 100 },
      ],
      patrol: [
        { x: 1500, y: 1000, z: -1500 },
        { x: 3500, y: 1000, z: -600 },
      ],
    },
    {
      kind: 'enemyFighter',
      group: 'escort-bandits',
      count: 2,
      difficulty: 'normal',
      trigger: { type: 'time', seconds: 30 },
      attack: 'transport',
      positions: [
        { x: -800, y: 1200, z: -5300, headingDeg: 190 },
        { x: 200, y: 1300, z: -5600, headingDeg: 190 },
      ],
      patrol: [
        { x: -500, y: 1000, z: -1500 },
        { x: -3000, y: 1000, z: -600 },
      ],
    },
  ],
  objectives: [
    {
      id: 'escort',
      type: 'escort',
      required: true,
      start: 'withPrevious',
      group: 'convoy',
      destination: ESCORT_ROUTE.destination,
    },
    {
      id: 'bandits',
      type: 'kill',
      required: false,
      start: 'withPrevious',
      target: 'enemyFighter',
      group: 'escort-bandits',
      count: 4,
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'escortLost', 'outOfBounds'],
  reward: { baseCredits: 2000 },
};

/**
 * M4 爆撃: 島の地上目標 4 つ（レーダー・燃料タンク・格納庫・対空砲）を破壊する。敵機はなし。
 * 対空砲（normal、命中率 30%）は島の西、レーダーから 2.3km・開始位置から 3.7km。600〜2500m に入ると撃ってくる。
 * 目標は島の四方の低い所（地表 300m 未満）。位置は 2-5 の仮置きと同じ
 */
export const STRIKE_MISSION: MissionDef = {
  id: 'strike',
  mapId: 'island',
  start: { x: 0, y: 600, z: 4500, headingDeg: 0 },
  timeLimitSeconds: 360,
  parTimeSeconds: 180,
  spawns: [
    {
      kind: 'groundTarget',
      group: 'depots',
      targetType: 'radar',
      trigger: { type: 'start' },
      positions: [{ x: 900, z: 1700 }],
    },
    {
      kind: 'groundTarget',
      group: 'depots',
      targetType: 'aaa',
      trigger: { type: 'start' },
      positions: [{ x: -1300, z: 1000 }],
      difficulty: 'normal',
    },
    {
      kind: 'groundTarget',
      group: 'depots',
      targetType: 'hangar',
      trigger: { type: 'start' },
      positions: [{ x: -800, z: -1600 }],
    },
    {
      kind: 'groundTarget',
      group: 'depots',
      targetType: 'fuelTank',
      trigger: { type: 'start' },
      positions: [{ x: 1600, z: -900 }],
    },
  ],
  objectives: [
    {
      id: 'depots',
      type: 'destroy',
      required: true,
      start: 'withPrevious',
      group: 'depots',
      count: 4,
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 2000 },
};

/** M5 の怪獣の出現位置（島の南東の海。海岸線から 約 1.7km 沖）と、歩いて向かう先（島の南東の内陸） */
export const KAIJU_ROUTE = {
  position: { x: 3300, z: 3300 },
  walkTo: { x: 1000, z: 1000 },
} as const;

/**
 * M5 遭遇: 島の南東で敵機 2 機（easy。怪獣に集中できるよう M2 より弱い）と戦っていると、30 秒後に怪獣（仮実装）が海から現れ、島に向かって歩く。
 * 怪獣の HP を 20% 削ると海へ引き返して成功。敵機の撃墜は任意
 */
export const ENCOUNTER_MISSION: MissionDef = {
  id: 'encounter',
  mapId: 'island',
  start: { x: 0, y: 600, z: 4500, headingDeg: 45 },
  timeLimitSeconds: 420,
  parTimeSeconds: 180,
  spawns: [
    {
      kind: 'enemyFighter',
      group: 'encounter-bandits',
      count: 2,
      difficulty: 'easy',
      trigger: { type: 'start' },
      positions: [
        { x: 1500, y: 1100, z: 1500, headingDeg: 200 },
        { x: 2600, y: 1200, z: 2000, headingDeg: 220 },
      ],
      patrol: [
        { x: 2500, y: 1000, z: 2500 },
        { x: 500, y: 1100, z: 3000 },
        { x: 500, y: 1000, z: 500 },
        { x: 3000, y: 1100, z: 500 },
      ],
    },
    {
      kind: 'kaiju',
      trigger: { type: 'time', seconds: 30 },
      position: KAIJU_ROUTE.position,
      walkTo: KAIJU_ROUTE.walkTo,
      retreatDamageRatio: 0.2,
    },
  ],
  objectives: [
    { id: 'kaiju', type: 'kaiju', required: true, start: 'withPrevious', damageRatio: 0.2 },
    {
      id: 'bandits',
      type: 'kill',
      required: false,
      start: 'withPrevious',
      target: 'enemyFighter',
      group: 'encounter-bandits',
      count: 2,
    },
  ],
  success: 'allRequiredObjectives',
  failConditions: ['playerDown', 'timeUp', 'outOfBounds'],
  reward: { baseCredits: 3000 },
};

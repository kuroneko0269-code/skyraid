// リングレース（7-1）の数値。コースは src/data/courses.ts、進行は src/missions/race/、表示は src/ui/race-*.ts
// 時間は秒、距離は m

import type { Rank } from './ranking';

export const RACE_CONFIG = {
  /** スタート前のカウントダウン（3・2・1・GO）。その間は開始位置に止めてスロットル全開で待つ */
  countdownSeconds: 3,
  /** リングを通らずに先へ進んだときのペナルティ（1 個あたり。戻らなくて良い） */
  missPenaltySeconds: 5,
  /** 細いリングを通ったときのタイムボーナス（1 個あたり。タイムから引く） */
  thinBonusSeconds: 2,
  /** 細いリングの半径の倍率（通常の半分） */
  thinRadiusScale: 0.5,
  /** ブーストリングを通るとゲージを使わずにアフターバーナーが効く秒数 */
  boostSeconds: 3,
  /** 通過とみなす半径 = 見た目の半径 × この倍率（2-4 のリング 40 → 46m と同じ比） */
  passRadiusScale: 46 / 40,
  /** ゴールの後、大きな文字を出してからリザルトへ移るまで */
  finishBannerSeconds: 2.5,
  /** ランク: ゴールドタイム以下で S、ゴールドタイム × a 以下で A、× b 以下で B、完走で C */
  rankRatios: { A: 1.15, B: 1.3 },
  /**
   * 報酬（CR）: ランクごとの額。初クリアはそのランクの額（C なら 1500）、ランクを更新したら前のランクの額との差額、
   * それ以外の完走は repeat。時間切れは 0
   */
  rankRewards: { S: 3000, A: 2500, B: 2000, C: 1500 } satisfies Record<Rank, number>,
  repeatReward: 300,
  /** コースごとに残すタイムの数 */
  bestTimes: 5,
  /** スプリット・ゴーストとの差・タイム加減の表示秒数 */
  splitShowSeconds: 3,
  /** ゴースト: 位置・姿勢を記録する頻度（Hz） */
  ghostHz: 15,
  /** ゴーストの位置の量子化（m。Int16 なので ±8191m まで） */
  ghostPositionStep: 0.25,
  /** ゴーストの機体の不透明度 */
  ghostOpacity: 0.35,
  /** コースの保証条件（tests/race-course.test.ts）: リングの中心は地表から minRingAgl m 以上 */
  minRingAgl: 30,
  /** 前のリング（1 個目は開始位置）から見える: 線分が地形・建物から sightClearance m 以上離れ、maxSightDistance 以内 */
  sightClearance: 8,
  maxSightDistance: 3000,
  /** 連続するリングの間の必要旋回率が、機体（全機体の未強化）の最大ピッチ角速度の maxTurnFraction 以下 */
  maxTurnFraction: 0.8,
  /** リングの色（sRGB）: 次のリングは種類の色で発光、その先は同じ色を半透明に */
  colors: { normal: 0xffd23a, boost: 0xff7a2a, thin: 0xff5fd0, checkpoint: 0x5cff8a },
} as const;

/**
 * リングレース（7-1）の音（定位なし）。リング通過は上がる 2 音のチャイムで、種類で音程を変える
 * （通常 A5→E6・ブースト 1 音低く長め＋ノコギリ波・細い 高く短い・チェックポイント 3 音）。未通過は下がる 2 音、ゴールは長い和音。
 * カウントダウンの 3・2・1 と GO は PvP（UI_SOUND の countdown / go）と同じ
 */
export const RACE_SOUND = {
  gain: 0.24,
  ring: {
    normal: { freqs: [880, 1318.5], step: 0.05, duration: 0.18, wave: 'triangle' },
    boost: { freqs: [659.25, 987.77], step: 0.06, duration: 0.42, wave: 'sawtooth' },
    thin: { freqs: [1318.5, 1975.5], step: 0.04, duration: 0.14, wave: 'triangle' },
    checkpoint: { freqs: [880, 1108.7, 1318.5], step: 0.06, duration: 0.3, wave: 'triangle' },
  },
  miss: { freqs: [392, 277.18], step: 0.1, duration: 0.3, wave: 'square' },
  goal: {
    freqs: [523.25, 659.25, 783.99, 1046.5, 1318.5],
    step: 0.07,
    duration: 1.1,
    wave: 'triangle',
  },
} as const;

export type RaceSoundKind = keyof typeof RACE_SOUND.ring | 'miss' | 'goal';

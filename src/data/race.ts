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
 * 9-8 の道案内（全コース共通。判定・タイムには使わない）: 次とその次のリングの番号と色・それより先のリングを控えめに・
 * 画面外の矢印と距離・普通に飛ぶと通れないリングの印・道筋の点線・通り損ねの表示・スタート前のコースの下見
 */
export const RACE_GUIDE = {
  /** 3 個目より先のリングの色: 種類の色を dimColor へ dimMix だけ寄せる（次・その次は種類の色のまま） */
  dimColor: 0x2a3640,
  dimMix: 0.6,
  /** 印: 法線の上向きの角度がこれ以上なら「上へ」、−これ以下なら「下へ」（度） */
  steepPitchDeg: 60,
  /**
   * 印: 前の（急でない）リングから方位が reverseDeg 以上変わり、高さが reverseRise m 以上上なら「宙返り」、
   * 下なら「引き起こし」（上下に回って向きを変えるリング）
   */
  reverseDeg: 120,
  reverseRise: 300,
  /** 通り損ね: 次のリングが進む向きから missAngleDeg より後ろ（missDistance m より遠く）で出し、clearAngleDeg 内に戻ったら消す */
  missAngleDeg: 100,
  clearAngleDeg: 70,
  missDistance: 60,
  /**
   * 道筋の点線: 点の間隔（m）・点の大きさ（m。遠いほど小さく）・不透明度・色。
   * 9-9b: 飛行中は自機 → 次のリング → その次のリングの 2 区間だけ（9-8 は前のリング → 次 → その先 2 個の 3 区間）にし、
   * 細く・薄く（大きさ 7 → 4・不透明度 0.8 → 0.45）。自機から dotNear m の内の点は描かない（近すぎて大きく見える）。
   * 下見の間は道筋の全部に 9-8 の大きさ・不透明度で（点の数が maxDots を超えるコースは間隔を広げる）
   */
  dotSpacing: 28,
  dotSize: 4,
  dotOpacity: 0.45,
  dotNear: 40,
  previewDotSize: 7,
  previewDotOpacity: 0.8,
  dotColor: 0xffffff,
  /** 点線の点の最大数（下見で道筋の全部（最長の海岸周回 約 21km ÷ 28m）を並べられる数） */
  maxDots: 900,
  /** 道筋の点線の初期値（設定 → 表示で OFF にできる） */
  guideLineDefault: true,
  /**
   * コースの下見: スタート前にカメラが道筋をたどる。秒数は道筋の長さ ÷ previewSpeed を min〜max に収める。
   * カメラは道筋の behind m 後ろ・rise m 上から、lookAhead m 先を見る。最後の fadeSeconds は開始位置へ寄せる
   */
  preview: {
    minSeconds: 10,
    maxSeconds: 20,
    speed: 900,
    behind: 160,
    rise: 70,
    lookAhead: 380,
    /** 始めと終わりのゆっくりの割合（0〜0.5） */
    ease: 0.12,
  },
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

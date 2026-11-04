// チュートリアルの課題（9-5c）の種類と判定の数値。判定は src/missions/tutorial/tasks.ts（Three.js 非依存）、
// 章の組み立ては src/data/tutorial.ts。角度は度、距離は m、時間は秒

export const TUTORIAL_TASKS = [
  /** 傾けてから離して、翼と機首が水平のまま少し飛ぶ */
  'level',
  /** 上がってから下がる（進み具合 1 = 上がった・2 = 下がった） */
  'climb',
  /** スロットルを下げて遅くする */
  'slow',
  /** 前を飛ぶ的の後ろ（射程の内・機首の前）に付いていく（進み具合は秒） */
  'follow',
  /** 機首の印を照準の○に重ねる（自動射撃と同じ判定。少しの間） */
  'aim',
  /** ミサイルのロック */
  'lock',
  /** ロックしてミサイルを撃つ */
  'launch',
  /** ミサイルを撃ち尽くして補充を待つ */
  'resupply',
  /** ミサイルの警告が出ている間にフレアを撒く */
  'flare',
  /** 宙返りの頂点（背中が下・機首が水平）まで回る */
  'loopTop',
  /** 宙返りの頂点から水平に戻して反対向きに飛ぶ */
  'reverse',
  /** 対象を自分で切り替える */
  'select',
  /** 後ろに回った的を機首の前に戻す */
  'behind',
] as const;
export type TutorialTask = (typeof TUTORIAL_TASKS)[number];

export const TUTORIAL_TASK_CONFIG = {
  level: {
    /** まずこれだけ傾ける（バンク角） */
    bankDeg: 30,
    /** 水平の幅（バンク角・機首の上下） */
    levelDeg: 10,
    holdSeconds: 1.5,
  },
  climb: { meters: 150 },
  slow: { speed: 220 },
  follow: {
    minDistance: 250,
    maxDistance: 1400,
    coneDeg: 25,
    /** 的（ドローン）を出す: 自機の前方・高さ・速さ・経路の長さ */
    ahead: 2200,
    speed: 110,
    length: 9000,
  },
  /** 当たる所に重ねていた時間（秒）。1 回撃てば分かるくらい */
  aim: { holdSeconds: 0.5 },
  flare: {
    /** 撃たせるミサイル: 自機の後ろ・横・上下の位置（燃焼の間に届く近さ）、ミサイルの初速、次を撃つまでの間（秒） */
    behind: 1500,
    side: 300,
    above: 100,
    speed: 320,
    intervalSeconds: 4,
    /** 最初のミサイルまで（秒。文を読む間） */
    firstSeconds: 3,
  },
  loop: {
    /** 機首がこれより上がったら宙返りに入った */
    entryDeg: 70,
    /** 頂点: 背中が下（上向きの y がこれより小さい）・機首の上下がこの幅 */
    topUpY: -0.5,
    topPitchDeg: 35,
    /** 戻した: バンク・機首の上下の幅と、宙返りに入ったときの方位からのずれ */
    levelDeg: 25,
    reverseDeg: 120,
    /** NEED SPEED のヒント: 機首がこれより上でこの速さより遅い */
    needSpeedDeg: 60,
    needSpeed: 170,
    /** 章の始めの速さとスロットル（遅いと NEED SPEED。AB で加速してから回る体験） */
    startSpeed: 170,
    startThrottle: 0.45,
  },
  select: {
    /** 前の対象がまだこの角度内（画面に見えている）で切り替えた */
    keepDeg: 60,
  },
  behind: {
    /** 的を置く: 自機の後ろ（機首から 180° ± 30°）・距離・高さの差 */
    distance: 1400,
    sideDeg: 30,
    /** 前に戻した: 機首から */
    foundDeg: 12,
    speed: 110,
    length: 9000,
  },
} as const;

// ミッションの出現物（2-5）の数値: 輸送機（護衛対象）・怪獣の仮実装・地上目標の仮置き。
// ロジックは src/entities/transport.ts / kaiju-placeholder.ts / ground-target-placeholder.ts、描画は src/render/mission-props-view.ts。
// 距離は m、時間は秒。怪獣は 6-1、地上目標は 2-6 で作り直す前提のプレースホルダー

/** 輸送機（M3 の護衛対象）。直線経路を一定速度で飛ぶだけ（回避しない）。陣営はプレイヤー側 */
export const TRANSPORT_CONFIG = {
  /** 飛ぶ速さ（m/s）。指示の値。初期機の巡航（250）の約半分なので、追い越して前に出られる */
  speed: 120,
  /** HP。敵の機銃（1 発 5）なら 60 発、敵のミサイルは直撃 2〜3 発 */
  maxHp: 300,
  /** 当たり判定の球の半径（翼幅 30m・長さ 26m の大型機） */
  hitRadius: 14,
  visualRadius: 15,
  /** 同時に出せる数 */
  maxCount: 2,
  hitFlashSeconds: 0.08,
  color: 0xd9dee6,
} as const;

/**
 * 怪獣の仮実装（M5。6-1 で本実装）。箱（胴）+ 円錐（頭）で高さ 150m。
 * 海から浮かび上がり、島に向かってゆっくり歩く。攻撃しない。HP の retreatDamageRatio を削られると海へ引き返して沈む
 */
export const KAIJU_PLACEHOLDER_CONFIG = {
  /** 全体の高さ（胴 + 頭） */
  height: 150,
  /** 胴（箱）の幅・高さ・奥行き */
  body: { width: 56, height: 110, depth: 40 },
  /** 頭（円錐）の半径。高さは height − body.height */
  headRadius: 24,
  /**
   * HP。初期機の機銃（1 発 10）で 20% = 1200 は 120 発（連射 8 秒分）、ミサイル（中心 150）なら 8 発。
   * 敵機 2 機と戦いながら 1〜2 分で削れる量
   */
  maxHp: 6000,
  /** 当たり判定は 1 つの球（足元から centerHeight の高さ、半径 hitRadius）。部位 HP は 6-1 */
  hitRadius: 70,
  centerHeight: 80,
  visualRadius: 75,
  /** 海から浮かび上がる時間（足元が海面の height 下 → 海面または地表） */
  riseSeconds: 8,
  /** 歩く速さ（m/s）。人の速足の 3 倍程度。7 分で約 2.5km */
  walkSpeed: 6,
  /** 引き返すときの速さと、沈みきるまでの時間 */
  retreatSpeed: 10,
  sinkSeconds: 12,
  hitFlashSeconds: 0.08,
  color: 0x3d4a3a,
  headColor: 0x6b5a3e,
} as const;

/** 地上目標の仮置き（M4。2-6 で地上目標と無誘導兵器を作るまでの「静止した大きな的」） */
export const GROUND_TARGET_PLACEHOLDER_CONFIG = {
  /** 箱の大きさ（幅・高さ・奥行き）。地表に置く */
  size: { width: 30, height: 16, depth: 30 },
  /** HP。機銃 40 発（連射 約 3 秒）、ミサイルなら 3 発 */
  maxHp: 400,
  /** 当たり判定の球の半径（箱の中心から角まで 約 23m） */
  hitRadius: 22,
  visualRadius: 20,
  /** 同時に出せる数 */
  maxCount: 8,
  hitFlashSeconds: 0.08,
  color: 0xb5562b,
} as const;

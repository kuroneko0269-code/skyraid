// ミッションの出現物（2-5）の数値: 輸送機（護衛対象）・地上目標の仮置き。怪獣は 6-1 で src/data/kaiju.ts に移した。
// ロジックは src/entities/transport.ts、描画は src/render/mission-props-view.ts。距離は m、時間は秒

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

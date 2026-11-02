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

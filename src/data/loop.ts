// ゲームループの時間パラメータ
export const LOOP_CONFIG = {
  /** 固定タイムステップの更新頻度（Hz） */
  updateHz: 60,
  /**
   * 1フレームで進める実時間の上限（秒）。
   * タブ復帰直後などの巨大な dt をここで切り捨て、更新の暴走（spiral of death）を防ぐ
   */
  maxFrameSeconds: 0.25,
} as const;

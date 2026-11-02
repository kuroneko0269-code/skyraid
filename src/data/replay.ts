// リプレイ（7-B）の数値。記録・再生・保存・画面

export const REPLAY_CONFIG = {
  /** 記録の形式の版（.skyreplay とセーブのゴーストの形） */
  format: 1,
  /**
   * 判定の版。飛行・戦闘・AI・ミッションの判定を変えたら上げる（古い記録は「この版では再現できないかもしれない」と出す）。
   * 7-B で 1
   */
  simVersion: 1,
  /** 入力の量子化: 操縦（ピッチ・ロール・ヨー・スロットルの上げ下げ）は ±127 段、スロットル目標は 1000 段 */
  axisSteps: 127,
  throttleTargetSteps: 1000,
  /** 再生の速さ */
  speeds: [0.25, 0.5, 1, 2, 4] as const,
  /** 10 秒スキップ */
  skipSeconds: 10,
  /** シークのキーフレームの間隔（秒）と、丸ごとの写しを撮る間隔（秒。間は差分） */
  keyframeSeconds: 1,
  baseKeyframeSeconds: 60,
  /** 先へのシークで、1 描画フレームに計算するステップ数の上限（画面を止めないため） */
  seekStepsPerFrame: 300,
  /** 前の版の記録を再生するときの断りを出す秒数（8-7） */
  versionNoticeSeconds: 6,
  /** これより短い飛行は自動保存しない（秒） */
  minSeconds: 5,
  /** 自動保存（直近）と、名前を付けた保存の上限 */
  autoKeep: 10,
  savedMax: 30,
  /** 名前の最大文字数 */
  nameMax: 40,
  /** ファイルの拡張子 */
  extension: '.skyreplay',
  /** IndexedDB のデータベース名と版 */
  dbName: 'skyraid-replays',
  dbVersion: 1,
  /** 1 分あたりの容量の目安（テストの上限。バイト） */
  bytesPerMinuteMax: 10 * 1024,
  /** シネマカメラ: 1 つのカメラの秒数、機体からの距離（m）、先回りの秒数 */
  cinema: { shotSeconds: 6, distance: 260, leadSeconds: 3, minHeight: 25 },
  /** 敵視点カメラ: 対象の後ろ・上（m） */
  enemyView: { back: 40, up: 10 },
} as const;

// 連続値入力（タッチ・ゲームパッド）をボタン扱いするときのしきい値。使うのは src/core/input.ts

export const ANALOG_INPUT = {
  /** この値以上で「押した」（isDown / wasPressed） */
  pressThreshold: 0.5,
  /** 押下中はこの値を下回るまで「押したまま」。しきい値付近のバタつきを防ぐ */
  releaseThreshold: 0.35,
} as const;

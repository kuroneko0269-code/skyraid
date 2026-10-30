// ハンガー画面（3-3）の決めた値。画面は src/ui/hangar.ts、機体の展示は src/render/hangar-stage.ts

export const HANGAR_CONFIG = {
  /** この価格（CR）以上の購入・強化は確認ダイアログを出す。未満は 1 タップで確定 */
  confirmPrice: 10_000,
  /**
   * 機体の展示: フリーフライトの起動位置より南の沖、高度 650m に機体を置き、南（+Z）側から島の方を向いて見る
   * （背景に海・島・空）。機体は yawDegPerSecond でゆっくり回す
   */
  stage: {
    position: { x: 0, y: 650, z: 5600 },
    /** 機体から見たカメラの位置（m） */
    cameraOffset: { x: 0, y: 3, z: 28 },
    /** 注視点の高さ（機体の中心からの m） */
    lookAtHeight: 0,
    fov: 40,
    /** 画面の横縦比がこれより小さい（縦長）ときは、その比でカメラを遠ざける */
    minAspect: 1.4,
    yawDegPerSecond: 20,
    /** 機首の上げ角（度。少し傾けて上面の翼の形を見せる） */
    pitchDeg: 8,
  },
} as const;

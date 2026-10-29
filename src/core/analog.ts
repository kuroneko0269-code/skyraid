// 連続値入力の共通計算（タッチのスティック・ゲームパッドで共用）

/** 2次元ベクトルの書き込み先 */
export interface Vec2Out {
  x: number;
  y: number;
}

/**
 * 半径方向のデッドゾーン。長さ deadzone 未満は 0、外側は 0〜1 に引き伸ばし、長さ 1 で頭打ち。
 * 方向は保つ（斜めに倒したときに片軸だけ消えない）
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number, out: Vec2Out): Vec2Out {
  const len = Math.hypot(x, y);
  if (len <= deadzone || len === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const scaled = Math.min(1, (len - deadzone) / (1 - deadzone));
  out.x = (x / len) * scaled;
  out.y = (y / len) * scaled;
  return out;
}

/** 1軸のデッドゾーン（トリガー用）。0〜1 を返す */
export function applyDeadzone(value: number, deadzone: number): number {
  const v = Math.abs(value);
  if (v <= deadzone) return 0;
  return Math.min(1, (v - deadzone) / (1 - deadzone));
}

/** 縦スライダーの位置 → 0〜1（上端 = 1、下端 = 0） */
export function sliderValueFromY(clientY: number, top: number, height: number): number {
  if (height <= 0) return 0;
  const t = 1 - (clientY - top) / height;
  return Math.min(1, Math.max(0, t));
}

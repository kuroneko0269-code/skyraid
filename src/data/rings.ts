// リング（2-4。ミッションの「リング通過」）の数値。判定は src/missions/objectives/ring.ts、描画は src/render/ring-view.ts

export const RING_CONFIG = {
  /** 見た目の半径（輪の中心線）と輪の太さの半径（m） */
  radius: 40,
  tube: 2.5,
  /**
   * 通過とみなす半径。見た目より少し大きくして、縁をかすめても通ったことにする（アーケード寄り）。
   * 巡航 250 m/s では 1 ステップ（1/60 秒）で約 4m 進むので、面を横切る線分で判定する
   */
  passRadius: 46,
  /** 次に通るリングの色と明るさ（発光）・それ以外のリングの色（sRGB） */
  nextColor: 0xffd23a,
  nextIntensity: 1.6,
  otherColor: 0x6fe8ff,
  /** 次のリングの先の何個まで描くか（遠くのリングで画面を埋めない） */
  visibleAhead: 3,
} as const;
